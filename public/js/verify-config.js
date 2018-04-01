var _ = require('underscore');
var log = require('./log');

// reads config values, returns boolean indicating fatal config value missing/incorrect
var noFatalSettings = function(config) {
    if(!config) {
        log.error('No config found');
        return true;
    }
    
    if(_.isNaN(config.PORT)) {
        log.error('config.PORT not set to a valid number');
        return true;
    }
    
    var warnNonStrings = [ 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URL', 'GOOGLE_SEARCH_API_URL', 'GOOGLE_API_KEY', 'GOOGLE_SEARCH_ENGINE_ID' ];
    _.each(warnNonStrings, function(k) {
        if(!_.isString(config[k]) || config[k] == '') {
            log.warn('config.' + k + ' not a valid string or empty');
        }
    });
    return false;
};

// returns any error preventing services/spotify endpoints from operating
var verifySpotifyEndpoints = function(config) {
    var missing = [];
    var strings = [ 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URL' ];
    _.each(strings, function(k) {
        if(!_.isString(config[k]) || config[k] == '') {
            missing.push(k);
        }
    });
    
    if(missing.length > 0) {
        return 'Invalid keys: ' + missing.join(',');
    }
    return null;
};

// returns any error preventing google search api calls
var verifyGoogleSearchOperation = function(config) {
    var missing = [];
    var strings = [ 'GOOGLE_SEARCH_API_URL', 'GOOGLE_API_KEY', 'GOOGLE_SEARCH_ENGINE_ID' ];
    _.each(strings, function(k) {
        if(!_.isString(config[k]) || config[k] == '') {
            missing.push(k);
        }
    });
    
    if(missing.length > 0) {
        return 'missing keys: ' + missing.join(',');
    }
    return null;
};

exports.noFatalSettings = noFatalSettings;
exports.verifySpotifyEndpoints = verifySpotifyEndpoints
exports.verifyGoogleSearchOperation = verifyGoogleSearchOperation;
