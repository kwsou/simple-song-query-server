var request = require('request');
var Q = require('q');

var log = require('./log');

// generic request send invoker and handler
var send = function(req, res, reqOptions) {
    var deferred = Q.defer();
    
    var methodName, methodInvoke;
    switch(reqOptions.method) {
        case 'POST':
        case 'post':
            methodName = 'GET';
            methodInvoke = request.post;
            break;
        case 'PATCH':
        case 'patch':
            methodName = 'PATCH';
            methodInvoke = request.patch;
            break;
        case 'DELETE':
        case 'delete':
            methodName = 'DELETE';
            methodInvoke = request.delete;
            break;
        case 'GET':
        case 'get':
        default:
            methodName = 'GET';
            methodInvoke = request.get;
            break;
    }
    
    methodInvoke(reqOptions, function(error, response, body) {
        var errPayload = {
            res: res,
            response: response
        };
        
        if(!response) {
            errPayload.error = '(dispatcher.send) Expected response but got nothing. REQUEST: ' + reqOptions.method + ' ' + reqOptions.url;
            deferred.reject(errPayload);
            return;
        }
        
        log.info(['(dispatcher.send)', methodName, reqOptions.url, response.statusCode].join(' '));
        var acceptedStatusCodes = [200, 201, 204];
        if(acceptedStatusCodes.indexOf(response.statusCode) < 0) {
            errPayload.error = error || body;
            errPayload.error = JSON.stringify(errPayload.error);
            deferred.reject(errPayload);
            return;
        }
        
        if(reqOptions.expectBody && !body) {
            errPayload.error = '(dispatcher.send) Expected body but got nothing instead'
            deferred.reject(errPayload);
        }
        
        deferred.resolve(body);
    });
    
    return deferred.promise;
};

// generic error handler for send requests
var onError = function(payload) {
    log.error('(dispatcher.onError) ' + payload.error);
    payload.res.status(payload.response.statusCode).send(payload.error);
};

exports.send = send;
exports.onError = onError;
