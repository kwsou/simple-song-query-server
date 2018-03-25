var _ = require('underscore');

var log = require('./log');
var srv_spotify = require('./services/spotify');

var ENDPOINTS = [
    // retrieve user's currently playing song
    {
        method: 'GET',
        path: '/spotify/current-song',
        callback: srv_spotify.getCurrentSong
    },
    // spotify authentication call-back
    {
        method: 'GET',
        path: '/spotify/authorize',
        callback: srv_spotify.authorize
    }
];

var init = function(app, config) {
    _.each(ENDPOINTS, function(endpoint) {
        var attachEndpoint;
        switch(endpoint.method) {
            case 'POST':
                attachEndpoint = app.post;
                break;
            case 'PATCH':
                attachEndpoint = app.patch;
                break;
            case 'DELETE':
                attachEndpoint = app.delete;
                break;
            case 'GET':
            default:
                attachEndpoint = app.get;
                break;
        };
        
        log.writeInit(endpoint.method + ' ' + endpoint.path, 1);
        attachEndpoint.apply(app, [endpoint.path, function(req, res) {
            endpoint.callback(req, res, config);
        }]);
    });
}

exports.init = init;
