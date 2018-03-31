var express = require('express');
var cookieParser = require('cookie-parser');
var argv = require('minimist')(process.argv.slice(2));

var log = require('./public/js/log');
var checkConfig = require('./public/js/verify-config');
var router = require('./public/js/router');

// load config
var configPath = argv.config ? argv.config : './config/default';
log.writeInit('loading config at "' + configPath + '"...');

var config = require(configPath);
log.writeInit('retrieved config...');
for(var k in config) {
    log.writeInit(k + ': ' + config[k], 1);
}

if(!checkConfig.noFatalSettings(config)) {
    // initialize express server
    var app = express();
    app.use(cookieParser());
    
    log.writeInit('routing and exposing these endpoints...')
    router.init(app, config);
    
    // start express server
    app.listen(config.PORT, function() {
        log.writeLine('Server started and listening on port ' + this.address().port);
    });
} else {
    log.writeLine('Server not started because of errors found in config');
}
