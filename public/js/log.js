
var write = function(msg) {
    process.stdout.write(msg);
};

var _log = function(msg, level) {
    writeLine('[' + level + '] ' + msg);
};

var info = function(msg) { _log(msg, 'INFO'); };
var warn = function(msg) { _log(msg, 'WARN'); };
var debug = function(msg) { _log(msg, 'DEBUG'); };
var error = function(msg) { _log(msg, 'ERROR'); };

var writeLine = function(msg) {
    write(msg + '\n');
};

var writeInit = function(msg, tabs) {
    var prefix = '';
    
    if(tabs) {
        for(var i = 0; i < tabs; i++)  {
            prefix += '   ';
        }
    }
    
    writeLine(' |- ' + prefix + msg);
}

var writeEmptyLine = function() {
    writeLine('');
};

exports.info = info;
exports.warn = warn;
exports.debug = debug;
exports.error = error;

exports.writeLine = writeLine;
exports.writeInit = writeInit;
exports.writeEmptyLine = writeEmptyLine;
