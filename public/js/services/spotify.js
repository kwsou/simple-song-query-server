var request = require('request');
var querystring = require('querystring');
var uid = require('uid-safe');
var Q = require('q');
var lruCache = require('lru-cache');

var log = require('../log');
var checkConfig = require('../verify-config');

// https://accounts.spotify.com/authorize/?client_id=eccd6ce096a640dcb164d750b4d993ef&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A8888%2Fcallback&scope=user-read-currently-playing%20user-read-playback-state&state=test123

var COOKIE_STATE_KEY = 'spotify_auth_state';
var COOKIE_USER_KEY = 'spotify_username';
var cache = lruCache({ max: 10, maxAge: 1000 * 60 * 60 });
var refreshTokens = {};

/*
 * Endpoint to retrieve user's currently playing song.
 * 
 * This will first redirect you to spotify to authenticate yourself, which they
 * will then send back a call to our configured redirect url containing an auth code.
 * From there, we will ask for an access token that allows us to hit their web api.
 */
var getCurrentSong = function(req, res, config) {
    var onError = function(error, status) {
        log.error('(spotify.getCurrentSong) - ' + JSON.stringify(error));
        res.status(status || 400).send(error);
    };
    
    // No point in making calls to spotify if we don't have valid client id/secret
    var invalidKeys = checkConfig.verifySpotifyEndpoints(config);
    if(invalidKeys) { onError(invalidKeys, 500); return; }
    
    if(!req.query.username) { onError('Invalid username'); return; }
    res.cookie(COOKIE_USER_KEY, req.query.username);
	var username = req.query.username;
    
    // generate a state id which we will check later in our redirect callback to
    // ensure the original authenticity to prevent CSRF
    var state = uid.sync(20);
    res.cookie(COOKIE_STATE_KEY, state);
    
    if(cache.has(req.query.username)) {
        // already authorized this user at some point in time, and its access token is still active
        _getCurrentlyPlaying(req, res, config, cache.get(username), username).then(function(songInfo) {
            res.status(200).send(songInfo);
        }, onError);
    } else if(req.query.username in refreshTokens) {
        // already authorized this user in the past, but will need to regenerate access token
        _getTokens(req, res, config, username, refreshTokens[username]).then(function(tokenInfo) {
            _getCurrentlyPlaying(req, res, config, tokenInfo, username).then(function(songInfo) {
                res.status(200).send(songInfo);
            }, onError);
        }, onError);
    } else {
        // user has not authorized yet, send them to spotify to do so first
        res.redirect('https://accounts.spotify.com/authorize?' + querystring.stringify({
            response_type: 'code',
            client_id: config.SPOTIFY_CLIENT_ID,
            redirect_uri: config.SPOTIFY_REDIRECT_URL,
            scope: 'user-read-currently-playing',
            state: state
        }));
    }
};

// Redirect url callback we receive from spotify
var authorize = function(req, res, config) {
    var onError = function(error, status) {
        log.error('(spotify.authorize) - ' + JSON.stringify(error));
        res.status(status || 400).send(error);
    };
    
    if(!req.cookies) { onError('No cookies present'); return; }
    
    var stateFromRedirect = req.query.state || null;
    var stateFromOriginal = req.cookies[COOKIE_STATE_KEY] || null;
    
    if(stateFromOriginal !== stateFromRedirect) { onError('State mismatch'); return; }
    if(!req.cookies[COOKIE_USER_KEY]) { onError('Invalid username'); return; }
    if(req.query.error || !req.query.code) { onError(req.query.error); return; }
    
	var username = req.cookies[COOKIE_USER_KEY];
    _getTokens(req, res, config, username).then(function(tokenInfo) {
        _getCurrentlyPlaying(req, res, config, tokenInfo, username).then(function(songInfo) {
            res.status(200).send(songInfo);
        }, onError);
    }, onError);
};

// retrieve access and refresh tokens
var _getTokens = function(req, res, config, username, refreshToken) {
    var deferred = Q.defer();
    
    var reqOptions = {
        url: 'https://accounts.spotify.com/api/token',
        headers: {
            'Authorization': 'Basic ' + (new Buffer(config.SPOTIFY_CLIENT_ID + ':' + config.SPOTIFY_CLIENT_SECRET).toString('base64'))
        },
        json: true
    };
    
    if(refreshToken) {
        reqOptions.form = {
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        };
    } else {
        reqOptions.form = {
            code: req.query.code,
            redirect_uri: config.SPOTIFY_REDIRECT_URL,
            grant_type: 'authorization_code'
        };
    }
    
    request.post(reqOptions, function(error, response, body) {
        if(response && response.statusCode !== 200) {
            deferred.reject(error || body);
        }
        
        if(!body) {
            deferred.reject('Expected body for _getTokens but got nothing instead');
        }
        
        // save token information for faster access next time
        var ttl = body['expires_in'] ? body['expires_in'] * 1000 : null;
        cache.set(username, body, ttl);
        
        if(body['refresh_token']) {
            refreshTokens[username] = body['refresh_token'];
        }
        
        log.info('(spotify._getTokens) - access token renewed for ' + username);
        deferred.resolve(body);
    });
    
    return deferred.promise;
};

// retrieve user's currently playing song
var _getCurrentlyPlaying = function(req, res, config, tokenInfo, username) {
    var deferred = Q.defer();
    
    request.get({
        url: 'https://api.spotify.com/v1/me/player/currently-playing',
        headers: {
            'Authorization': 'Bearer ' + tokenInfo.access_token
        },
        json: true
    }, function(error, response, body) {
        if(response && response.statusCode !== 200) {
            deferred.reject(error || body);
        }
        
        if(!body) {
            deferred.reject('Expected body for _getCurrentlyPlaying but got nothing instead');
        }
        
        log.info('(spotify._getCurrentlyPlaying) - successfully retrieved song info for ' + username);
        deferred.resolve(body);
    });
    
    return deferred.promise;
};

exports.getCurrentSong = getCurrentSong;
exports.authorize = authorize;
