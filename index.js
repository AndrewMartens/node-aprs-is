var net = require('net');
var Packet = require('./packet');
var events = require('events');
var util = require('util');

function APRS() {
  if (!(this instanceof APRS)) return new APRS();

  this.state = 'disconnected';
  this.username = null;
  this.passcode = null;
  this.serverName = null;
  this.serverSoftwareName = null;
  this.serverSoftwareVersion = null;
  this.socket = null;

  events.EventEmitter.call(this);
}

util.inherits(APRS, events.EventEmitter);

APRS.prototype.connect = function(user, pass, options) {
  this.username = user;
  this.passcode = pass || null;
  this.host = options.host || 'noam.aprs2.net'
  this.port = options.port || 14580;
  this.debug = options.debug || false;
  this.defaultFilter = options.filter || null;

  var _this = this;
  var socket = net.connect({
    host: this.host,
    port: this.port
  });
  socket.on('connect', function() {
    _this.socket = this;
    _this.changeState('connected');
    _this.emit('connected');
  });
  socket.on('end', function() {
    _this.socket = null;
    _this.serverSoftwareName = null;
    _this.serverSoftwareVersion = null;
    _this.changeState('disconnected');
    _this.emit('disconnected');
  });
  socket.on('data', _this.parse.bind(_this));
};

APRS.prototype.disconnect = function() {
  this.socket.end();
};

APRS.prototype.changeState = function(state) {
  if (this.debug) {
    console.log('State changed:', state);
  }
  this.state = state;
  if ((this.state == 'verified,') && (this.defaultFilter)) {
    this.filter(this.defaultFilter);
  }
};

APRS.prototype.parse = function(buffer) {
  // data returns a buffer which we actually need to use because some "mic-e"
  // packet types have non-printable characters which don't survive conversion
  // to a string
  var data = buffer.toString('utf-8').slice(0, -2);

  if(data.charAt(0) === '#') {
    var tokens = data.split(' ');
    if(tokens[1] === 'logresp') {
      this.serverName = tokens[5];
      this.changeState(tokens[3]);
    } else if(tokens.length === 3) {
      this.serverSoftwareName = tokens[1];
      this.serverSoftwareVersion = tokens[2];
      this.login(this.username, this.passcode);
    }
  } else {
    var packet = new Packet(buffer);

    if (this.debug) {
      console.log('From:', packet.sourceAddress);
      console.log('Dest:', packet.destinationAddress);
      console.log('Data:', packet.payload);
      if(packet.time) {
        console.log('Time:', packet.time);
      } else {
        console.log('Time: NONE');
      }
      if(packet.latitude) {
        console.log(' Pos:', packet.latitude, packet.longitude);
      } else {
        console.log(' Pos: NONE');
      }
    }

    this.emit('packet', packet);
  }
};

APRS.prototype.filter = function(filter) {
  var filterstring;
  if(Array.isArray(filter)) {
    filterstring = filter.join(' ');
  } else {
    filterstring = filter;
  }
  var packet = '# filter ' + filterstring;
  console.log('Adding filter: ' + packet);
  this.socket.write(packet + '\r\n');
};

APRS.prototype.login = function(user, pass, name, version) {
  var pass = pass || '-1';
  var name = name || 'node-aprs-is';
  var version = version || '0.0.1';
  var packet = 'user ' + user + ' pass ' + pass + ' vers ' + name + ' ' + version;
  this.socket.write(packet + '\r\n');
};

module.exports = APRS;
