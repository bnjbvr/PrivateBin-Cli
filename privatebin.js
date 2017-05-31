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

var password = process.argv[2] || '',
    privatebinHost = process.argv[3] || 'colle.delire.party',
    privatebinProtocol = 'https',
    privatebinPort = 443,
    privatebinPath = '/',
    expiration = 'never',
    format = 'plaintext',
    burnafterreading = 1,
    opendiscussion = 0;

var fs = require('fs');
var querystring = require('querystring');
var http = require(privatebinProtocol);

var sjcl = require('./vendor/sjcl-1.0.6');
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

    var request = http.request(options, function(res) {
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
