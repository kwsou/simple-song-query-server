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
// lru caches with ttl
var cache_tokenInfo = lruCache({ max: 10, maxAge: 1000 * 60 * 60 });        // spotify username -> token info object
var cache_ext_urls = lruCache({ max: 500, maxAge: 1000 * 60 * 60 * 10 });   // search term -> array of urls
// permanent cache without ttl
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
    
    if(cache_tokenInfo.has(req.query.username)) {
        // already authorized this user at some point in time, and its access token is still active
        _getCurrentlyPlaying(req, res, config, cache_tokenInfo.get(username));
    } else if(req.query.username in refreshTokens) {
        // already authorized this user in the past, but will need to regenerate access token
        _getTokens(req, res, config, username, refreshTokens[username]).then(function(tokenInfo) {
            _getCurrentlyPlaying(req, res, config, tokenInfo);
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
        _getCurrentlyPlaying(req, res, config, tokenInfo);
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
        cache_tokenInfo.set(username, respBody, ttl);
        
        if(respBody.refresh_token) {
            refreshTokens[username] = respBody.refresh_token;
        }
        
        deferred.resolve(respBody);
    }, dispatcher.onError);
    
    return deferred.promise;
};

// retrieve user's currently playing song
var _getCurrentlyPlaying = function(req, res, config, tokenInfo) {
    return dispatcher.send(req, res, {
        method: 'GET',
        url: 'https://api.spotify.com/v1/me/player/currently-playing',
        headers: {
            'Authorization': 'Bearer ' + tokenInfo.access_token
        },
        json: true
    }).then(function(songInfo) {
        var parseInfoDeferred = Q.defer();
        var trackInfo = {
            is_playing: songInfo.is_playing,
            name: null,
            artists: [],
            album: {
                name: null,
                date: null,
                imgs: []
            }
        };
        
        if(!songInfo.is_playing) {
            // end the original request by sending in the song info
        	res.status(200).send(trackInfo);
            return;
        }
        
        trackInfo.name = songInfo.item.name;
        trackInfo.album.name = songInfo.item.album.name;
        trackInfo.album.date = songInfo.item.album.release_date;
        
        // attempt to grab suitable album name if none present
        if(!trackInfo.album.name || trackInfo.album.name == '') {
            var regexPatterns = [
                /\(.*?\)/g,  // anything inside parentheses
                /\[.*?\]/g,  // anything inside brackets
                /\-.*?\-/g   // anything inside hyphens
            ];
            
            regexPatterns.forEach(function(pattern) {
                if(!trackInfo.album.name) {
                    var m = trackInfo.name.match(pattern);
                    if(m) {
                        trackInfo.album.name = m.pop().slice(1, -1);
                    }
                }
            });
        }
        
        // retrieve artist/contributor names
        songInfo.item.artists.forEach(function(artist) {
            if(artist.name && artist.name != '') {
                trackInfo.artists.push(artist.name);
            }
        });
        
        // retrieve album image url hrefs
        var getImageUrlDeferred = Q.defer();
        if(songInfo.item.album.images.length > 0) {
            getImageUrlDeferred.resolve(songInfo.item.album.images);
        } else {
            // otherwise, we attempt to grab a suitable image from google
            _retrieveGoogleImageSearch(req, res, config, trackInfo).then(function(results) {
                getImageUrlDeferred.resolve(results);
            });
        }
        
        getImageUrlDeferred.promise.then(function(albumImages) {
            albumImages.forEach(function(imgInfo) {
                trackInfo.album.imgs.push(imgInfo.url);
            });
            parseInfoDeferred.resolve();
        });
        
        parseInfoDeferred.promise.then(function() {
            // end the original request by sending in the song info
        	res.status(200).send(trackInfo);
        });
    }, dispatcher.onError);
};

// makes a call to google's search api to retrieve a suitable album image url
var _retrieveGoogleImageSearch = function(req, res, config, trackInfo) {
    var deferred = Q.defer();
    
    var invalidKeys = checkConfig.verifyGoogleSearchOperation(config);
    if(invalidKeys) {
        log.error('(spotify._retrieveGoogleImageSearch) ' + invalidKeys);
        deferred.resolve([]);
        return deferred.promise;
    }
    
    // determine search term based on available information
    var searchTerm = _getSearchTerms(trackInfo);    
    if(!searchTerm) {
        log.error('(spotify._retrieveGoogleImageSearch) empty search term');
        deferred.resolve([]);
        return deferred.promise;
    }
    
    // if we already made the request previously, do not make it again
    if(cache_ext_urls.has(searchTerm)) {
        deferred.resolve(cache_ext_urls.get(searchTerm));
        return deferred.promise;
    }
    
    dispatcher.send(req, res, {
        method: 'GET',
        url: config.GOOGLE_SEARCH_API_URL,
        qs: {
            q: searchTerm,
            cx: config.GOOGLE_SEARCH_ENGINE_ID,
            key: config.GOOGLE_API_KEY,
            num: 3,
            safe: 'medium',
            searchType: 'image',
            imgColorType: 'color'
        },
        expectBody: true
    }).then(function(body) {
        var respBody = JSON.parse(body);
        
        var results = [];
        if(respBody && respBody.items && respBody.items.length > 0) {
            respBody.items.forEach(function(imgInfo) {
                results.push({ url: imgInfo.link });
            })
            // save to cache for next time potentially
            cache_ext_urls.set(searchTerm, results);
        } else {
            log.error('(spotify._retrieveGoogleImageSearch) No suitable images found for "' + searchTerm + '"');
        }
        deferred.resolve(results);
    }, function(err) {
        // silently fail
        log.error('(spotify._retrieveGoogleImageSearch) ' + err);
        deferred.resolve([]);
    });
    
    return deferred.promise;
};

// determines suitable search term based on given track information
var _getSearchTerms = function(trackInfo) {
    var searchTerms;
    if(trackInfo.album.name) {
        if(trackInfo.artists.length > 0) {
            searchTerms = [trackInfo.album.name].concat(trackInfo.artists);
        } else {
            searchTerms = [trackInfo.album.name, trackInfo.name];
        }
    } else {
        searchTerms = [trackInfo.name].concat(trackInfo.artists);
    }
    return searchTerms.join(' ');
}

exports.getCurrentSong = getCurrentSong;
exports.authorize = authorize;
