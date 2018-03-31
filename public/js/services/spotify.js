var request = require('request');
var querystring = require('querystring');
var uid = require('uid-safe');
var Q = require('q');
var lruCache = require('lru-cache');

var log = require('../log');
var checkConfig = require('../verify-config');
var dispatcher = require('../dispatcher');

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
        _getCurrentlyPlaying(req, res, cache.get(username));
    } else if(req.query.username in refreshTokens) {
        // already authorized this user in the past, but will need to regenerate access token
        _getTokens(req, res, config, username, refreshTokens[username]).then(function(tokenInfo) {
            _getCurrentlyPlaying(req, res, tokenInfo);
        });
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
        _getCurrentlyPlaying(req, res, tokenInfo);
    });
};

// retrieve access and refresh tokens
var _getTokens = function(req, res, config, username, refreshToken) {
    var deferred = Q.defer();

    var reqBody;
    if(refreshToken) {
        reqBody = {
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        };
    } else {
        reqBody = {
            code: req.query.code,
            redirect_uri: config.SPOTIFY_REDIRECT_URL,
            grant_type: 'authorization_code'
        };
    }
    
    dispatcher.send(req, res, {
        method: 'POST',
        url: 'https://accounts.spotify.com/api/token',
        headers: {
            'Authorization': 'Basic ' + (new Buffer(config.SPOTIFY_CLIENT_ID + ':' + config.SPOTIFY_CLIENT_SECRET).toString('base64'))
        },
        form: reqBody,
        json: true,
        expectBody: true
    }).then(function(respBody) {
        // save token information for faster access next time
        var ttl = respBody.expires_in ? respBody.expires_in * 1000 : null;
        cache.set(username, respBody, ttl);
        
        if(respBody.refresh_token) {
            refreshTokens[username] = respBody.refresh_token;
        }
        
        deferred.resolve(respBody);
    }, dispatcher.onError);
    
    return deferred.promise;
};

// retrieve user's currently playing song
var _getCurrentlyPlaying = function(req, res, tokenInfo) {
    return dispatcher.send(req, res, {
        method: 'GET',
        url: 'https://api.spotify.com/v1/me/player/currently-playing',
        headers: {
            'Authorization': 'Bearer ' + tokenInfo.access_token
        },
        json: true
    }).then(function(songInfo) {
        if(!songInfo) {
    		songInfo = { is_playing: false };
    	}
        
        // end the original request by sending in the song info
    	res.status(200).send(songInfo);
    }, dispatcher.onError);
};

exports.getCurrentSong = getCurrentSong;
exports.authorize = authorize;
