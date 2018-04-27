# simple-song-query-server
A simple query program that acts as a middle-man when users send a request to obtain currently playing song in particular services (i.e. spotify, youtube).

## Required Third-party API keys
* [Spotify API Dev Key](https://beta.developer.spotify.com/)
Used to be able to make calls to spotify's endpoints to retrieve currently playing songs

* [Google API Key](https://cloud.google.com/)
Used to search for relevant album images (via google search), as well as to search youtube videos

## Setup Steps
* Obtain a copy of the source
* Open a terminal and `cd` into the source
* Run `npm install` to obtain node dependencies
* Modify either the default config settings under `./config/default.js` or create a new one using the following structure:
```js
var _ = require('underscore');
var config = require('./default');

module.exports = _.extend(config, {
    'PORT': 8888,
    
    // log directory, be careful of backslashes -- they need to be double escaped
	'LOG_DIRECTORY': 'C:\\path\\to\\log\\directory',
    
    // lowest level of logging you want to have
	'LOG_LEVEL': 'debug',
	
    // obtain these from spotify
    'SPOTIFY_CLIENT_ID': '<insert client id here>',
    'SPOTIFY_CLIENT_SECRET': '<insert client secret here>',
    // don't forget to set the redirect url in spotify as well
    'SPOTIFY_REDIRECT_URL': 'http://<your server domain or ip>:<port>/spotify/authorize',
    
    // obtain these from google
    'GOOGLE_API_KEY': '<insert api key here>',
    'GOOGLE_SEARCH_ENGINE_ID': '<insert engine id here>'
});
```
* To run the server, run `node app.js --config="./config/custom"` (or `default` if you're overwriting the default config)
* If on Windows, I'd install this as a service so you don't need to run this every time your server reboots. I recommend [nssm](https://nssm.cc/) using these settings as an example:
```
Path: C:\Program Files\nodejs\node.exe
Startup directory: C:\Program Files\nodejs
Arguments: C:\dev\simple-song-query-server\app.js --config="./config/custom"
```
