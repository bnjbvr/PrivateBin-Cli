#!/usr/bin/env node

/**
 * PrivateBin-Cli
 *
 * a zero-knowledge paste bin
 *
 * @see       {@link https://github.com/PrivateBin/PrivateBin-Cli}
 * @copyright 2017 Simon Rupf ({@link http://privatebin.info})
 * @license   {@link https://www.opensource.org/licenses/zlib-license.php The zlib/libpng License}
 * @version   0.1
 * @name      PrivateBin-Cli
 * @namespace
 */

'use strict';

var fs = require('fs');
var querystring = require('querystring');
var http = require('http');
var https = require('https');

var sjcl = require('sjcl');
var args = require('optimist').argv;

var RawDeflate = require('./vendor/rawdeflate-0.5').RawDeflate;

function cipher(key, password, message)
{
    // Galois Counter Mode, keysize 256 bit, authentication tag 128 bit
    var options = {mode: 'gcm', ks: 256, ts: 128};

    var b64 = new Buffer(RawDeflate.deflate(message)).toString('base64');

    var actualKey = ((password || '').trim().length === 0)
                    ? key
                    : key + sjcl.codec.hex.fromBits(sjcl.hash.sha256.hash(password));

    return sjcl.encrypt(actualKey, b64, options);
}

function sendData(data) {
    if (data.length === 0) {
        console.warn("Nothing to send, early exit.");
        return;
    }

    var randomkey = sjcl.codec.base64.fromBits(sjcl.random.randomWords(8, 0), 0);

    var cipherdata = cipher(randomkey, password, data);

    var postData = querystring.stringify({
        data:             cipherdata,
        expire:           expiration,
        formatter:        format,
        burnafterreading: burnafterreading,
        opendiscussion:   opendiscussion
    });

    var options = {
        host: privatebinHost,
        port: privatebinPort,
        path: privatebinPath,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'X-Requested-With': 'JSONHttpRequest'
        }
    };

    var protocol = privatebinProtocol === 'http' ? http : https;
    var request = protocol.request(options, function(res) {
        res.setEncoding('utf8');

        var responseString = '';
        res.on('data', function (data) {
            responseString += data;
        });

        res.on('end', function () {
            var response = JSON.parse(responseString);
            if (response.status !== 0) {
                if (response.status === 1) {
                    console.error('Could not create paste: ' + response.message);
                } else {
                    console.error('Could not create paste: unknown status: ' + response.status);
                }
                process.exit(1);
            }

            var port = '';
            if ((privatebinProtocol === 'http' && privatebinPort !== 80) ||
                (privatebinProtocol === 'https' && privatebinPort !== 443)) {
                port += ':' + privatebinPort;
            }

            var privatebinUrl = privatebinProtocol
                                + '://'
                                + privatebinHost
                                + port
                                + privatebinPath;

            var url = privatebinUrl + '?' + response.id + '#' + randomkey;
            console.log('Your private paste URL is: ' + url);

            if (burnafterreading == 0) {
                var deleteUrl = privatebinUrl
                                + '?pasteid='
                                + response.id
                                + '&deletetoken='
                                + response.deletetoken;
                console.log('Your delete URL is: ' + deleteUrl);
            }
        });
    });

    request.on('error', function (error) {
        console.error('Could not create paste: ' + error.message);
        process.exit(5);
    });

    request.write(postData);
    request.end();
}

// main program

if (args.h || args.help) {
    console.log(process.argv[0] + ' -- a program to send paste from the command line to a privatebin server');
    console.log('--password SOMETHING / -p SOMETHING        uses SOMETHING as the password for this paste (no password by default)');
    console.log('--host HOST / -h HOST                      uses HOST as the private bin server host');
    console.log('--protocol PROTOCOL                        uses PROTOCOL as the protocol to connect to the privatebin server (http or https, https by default)');
    console.log('--port PORT / -P PORT                      uses PORT as the port to connect to the privatebin server (443 by default)');
    console.log('--path PATH                                the path from which the privatebin program is served (/ by default)');
    console.log('--expire EXPIRE / -e EXPIRE                EXPIRE notice for this paste (among "5min", "10min", "1hour", "1day", "1week", "1month", "1year", "never")');
    console.log('--format FORMAT / -f FORMAT                FORMAT to use for this paste (among "plaintext (default), syntaxhighlighting, markdown")');
    console.log('--burn / -b                                post this paste in burn-after-reading mode');
    console.log('--opendiscussion / -o                      opens this paste to discussion');
    process.exit(0);
}


var password = args.password || args.p || '';
var privatebinHost = args.host || args.h || 'colle.delire.party';

var privatebinProtocol = args.protocol || 'https';
if (['http', 'https'].indexOf(privatebinProtocol) < 0) {
    console.error("Protocol must be http or https, exiting.");
    process.exit(1);
}

var privatebinPort = args.port || args.P || 443;
try {
    if ((privatebinPort | 0) !== privatebinPort)
        throw new Error('not an integer');
    privatebinPort |= 0;
    if (privatebinPort < 0 || privatebinPort > 65536)
        throw new Error('not a valid port number');
} catch (err) {
    console.error('Port must be an integer between 0 and 65536');
    process.exit(1);
}

var privatebinPath = args.path || '/';

var expiration = args.expire || args.e || 'never';
if (["5min", "10min", "1hour", "1day", "1week", "1month", "1year", "never"].indexOf(expiration) < 0) {
    console.error('Expiration date must be a value as described in the help.');
    process.exit(1);
}

var format = args.format || args.f || 'plaintext';
if (['plaintext', 'syntaxhighlighting', 'markdown'].indexOf(format) < 0) {
    console.error('Format must be a value as described in the help.');
    process.exit(1);
}

var burnafterreading = (args.burn || args.b) ? 1 : 0;
var opendiscussion = (args.opendiscussion || args.o) ? 1 : 0;

var data = '';
process.stdin.on('readable', function() {
    var chunk = process.stdin.read();
    if (chunk !== null) {
        data += chunk.toString();
    }
});

process.stdin.on('end', function() {
    console.log('Sending content of stdout...');
    sendData(data.toString());
});
