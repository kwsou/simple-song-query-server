var _ = require('underscore');

var log = require('./log');
var srv_spotify = require('./services/spotify');

var ENDPONTS = {
    'GET': [
        {
            path: '/spotify/current-song',
            callback: srv_spotify.getCurrentSong
        },
        {
            path: '/spotify/authorize',
            callback: srv_spotify.authorize
        }
    ]
};

var init = function(app, config) {
    var exposedEndpoints = {};
    
    _.each(ENDPONTS, function(methodEndpoints, methodName) {
        exposedEndpoints[methodName] = [];
        _.each(methodEndpoints, function(endpoint) {
            exposedEndpoints[methodName].push(endpoint.path);
            app[methodName.toLowerCase()].apply(app, [endpoint.path, function(req, res) {
                endpoint.callback(req, res, config);
            }]);
        });
    });
    
    return exposedEndpoints;
}

exports.init = init;
