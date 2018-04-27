var express = require('express');
var cookieParser = require('cookie-parser');
var argv = require('minimist')(process.argv.slice(2));
var morgan = require('morgan');
var _ = require('underscore');

var log = require('./public/js/log');
var checkConfig = require('./public/js/verify-config');
var router = require('./public/js/router');

// load config
var configPath = argv.config ? argv.config : './config/default';
var config = require(configPath);

// initialize logger settings
log.init(config);
log.debug('config: {0}', JSON.stringify(config));

if(!checkConfig.noFatalSettings(config)) {
    // initialize express server
    var app = express();
    
    // read cookies automatically
    app.use(cookieParser());
    
    // log all requests, wrap the log writing to our own logger methods
    app.use(morgan('tiny', {
        stream: {
            write: function(msg) {
                // log message provided from morgan contains newline at the end, remove it manually
                log.http(msg.replace('\n', ''));
            }
        }
    }));
    
    // add available endpoints
    var exposedEndpoints = router.init(app, config);
    log.info('endpoints: {0}', JSON.stringify(exposedEndpoints));
    
    // start express server
    app.listen(config.PORT, function() {
        log.info('Server started and listening on port {0}', this.address().port);
    });
} else {
    log.error('Server not started because of errors found in config');
}
