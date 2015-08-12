var Packet = function(buffer, options) {
  if(Buffer.isBuffer(buffer)) {
    // Decode the string
    var content = buffer.toString('utf-8');
    var destinationIndex = content.indexOf('>');
    var payloadIndex = content.indexOf(':');

    this.sourceAddress = content.slice(0, destinationIndex);
    this.destinationAddress = content.slice(destinationIndex + 1, payloadIndex);
    this.destinationBuffer = buffer.slice(destinationIndex + 1, payloadIndex);
    this.payload = content.slice(payloadIndex + 1);
    this.payloadBuffer = buffer.slice(payloadIndex + 1);

    var position;
    // Determine packet type
    switch(this.payload.charAt(0)) {
      case '\x1c':  // Current mic-e
      case '\x1d':  // Old mic-e
      case '`':     // Current mic-e
      case '\'':    // Old mic-e or new TM-D700
        this.packetType = 'mic-e';
        position = Packet.decodeMicE(this.destinationBuffer, this.payloadBuffer);
        if (position === undefined) {
          console.log('Unable to process mic-e packet: ' + this.destinationAddress, this.payload);
        }
        break;
      case '/': // Position, w/ timestamp, w/o messaging
      case '@': // Position, w/ timestamp, w/ messaging
        this.packetType = 'position';
        this.time = Packet.decodeTime(this.payload.slice(1,8));
        position = Packet.decodePosition(this.payload.slice(8, 27));
        break;
      case '!': // Position, w/o timestamp, w/o messaging
      case '=': // Position, w/o timestamp, w/ messaging
        this.packetType = 'position';
        this.time = Packet.decodeTime();
        position = Packet.decodePosition(this.payload.slice(1,20));
        break;
    }
    if(position) {
      this.latitude = position.latitude;
      this.longitude = position.longitude;
      this.symbol = position.symbolTable + position.symbolCode;
    }
  } else {
    // Unpack the options

  }
}

// doesn't yet handle speed, heading, altitude, higher-accuracy !DAO! or text
Packet.decodeMicE = function(destination, payload) {
  // decode latitude and some flags from destination
  // don't care about message types
  if (destination.length < 6) {
    return;
  }

  var ret = {},
    d1 = destination.readUInt8(0) & 0x0F,
    d0 = destination.readUInt8(1) & 0x0F,
    m1 = destination.readUInt8(2) & 0x0F,
    m0 = destination.readUInt8(3) & 0x0F,
    h1 = destination.readUInt8(4) & 0x0F,
    h0 = destination.readUInt8(5) & 0x0F,
    ns = (destination.readUInt8(3) & 0x50) == 0x50,
    l100 = (destination.readUInt8(4) & 0x50) == 0x50,
    ew = (destination.readUInt8(5) & 0x50) != 0x50;

  ns = ns ? 1 : -1; // convert to 1 (north) or -1 (south)
  ew = ew ? 1 : -1; // convert to 1 (east) or -1 (west)
  ret.latitude = ((d1*10 + d0) + (m1*10 + m0 + h1*0.1 + h0*0.01)/60) * ns;

  if (payload.length < 10) {
    return;
  }

  // decode longitude
  // don't care about speed, course, symbol code or table id
  var ld, lm, lh;

  ld = payload.readUInt8(1); // 0 offset is the packet type
  if ((ld >= 118) && l100) {
    // special condition where it's actually 0-9 degrees)
    // http://www.aprs.org/doc/APRS101.PDF page 47
    ld = (ld - 118);
  } else {
    ld = (ld - 28) + (100*l100);
  }

  lm = payload.readUInt8(2);
  if (lm >= 88) {
    lm = lm - 88;
  } else {
    lm = lm - 28;
  }

  lh = payload.readUInt8(3);
  lh = lh - 28;

  ret.longitude = (ld + (lm + lh*0.01)/60) * ew;
  ret.symbolTable = payload.toString('ascii', 8, 9);
  ret.symbolCode = payload.toString('ascii', 7, 8);

  return ret;
};

Packet.decodeCoordinate = function(value) {
  var position = value.slice(0, -1);
  var hemisphere = value.slice(-1);
  var tokens = position.split('.');
  var deg = Number(tokens[0].slice(0, -2));
  var min = Number(tokens[0].slice(-2));
  min += Number(tokens[1]) / 100;
  var coordinate = deg + min / 60;
  if(hemisphere === 'S' || hemisphere === 'W') {
    coordinate *= -1;
  }
  return coordinate;
};

Packet.encodeCoordinate = function(value, type) {
  type = type || 'latitude';
  var coordinate = '';
  var deg = ~~value;
  var min = (Math.abs(value - deg) * 60);
  var intMin = ~~ min;
  var decMin = ~~((min - intMin) * 100);
  var pad = '000';
  if(type === 'longitude') {
    coordinate += String(pad + Math.abs(deg)).slice(-3);
  } else {
    coordinate += String(pad + Math.abs(deg)).slice(-2);
  }
  coordinate += String(pad + intMin).slice(-2) + '.';
  coordinate += String(pad + decMin).slice(-2);
  if(value >= 0) {
    if(type === 'longitude') {
      coordinate += 'E';
    } else {
      coordinate += 'N';
    }
  } else {
    if(type === 'longitude') {
      coordinate += 'W';
    } else {
      coordinate += 'S';
    }
  }
  return coordinate;
};

Packet.compressLatitude = function(value) {
  return Packet.base91encode(380926 * (90 - value));
};

Packet.decompressLatitude = function(value) {
  return 90 - (Packet.base91decode(value) / 380926);
}

Packet.compressLongitude = function(value) {
  return Packet.base91encode(190463 * (180 + value));
}

Packet.decompressLongitude = function(value) {
  return -180 + (Packet.base91decode(value) / 190463);
}

Packet.decodePosition = function(value) {
  return {
    symbolTable: value.charAt(8),
    symbolCode: value.charAt(18),
    latitude: Packet.decodeCoordinate(value.slice(0, 8)),
    longitude: Packet.decodeCoordinate(value.slice(9, 18))
  };
}

Packet.encodePosition = function(latitude, longitude, table, code) {
  return Packet.encodeCoordinate(latitude, 'latitude') +
    (table || '/') +
    Packet.encodeCoordinate(longitude, 'longitude') +
    (code || '-');
}

Packet.decodeTime = function(value) {
  var time = new Date();
  if(typeof value === 'string') {
    switch(value.slice(-1)) {
      case 'z':
        time.setUTCDate(Number(value.slice(0,2)));
        time.setUTCHours(Number(value.slice(2, 4)));
        time.setUTCMinutes(Number(value.slice(4, 6)));
        time.setUTCSeconds(0);
        time.setUTCMilliseconds(0);
        break;
      case '/':
        time.setDate(Number(value.slice(0,2)));
        time.setHours(Number(value.slice(2, 4)));
        time.setMinutes(Number(value.slice(4, 6)));
        time.setSeconds(0);
        time.setMilliseconds(0);
        break;
      case 'h':
        time.setUTCHours(Number(value.slice(0,2)));
        time.setUTCMinutes(Number(value.slice(2,4)));
        time.setUTCSeconds(Number(value.slice(4,6)));
        time.setUTCMilliseconds(0);
        break;
      default:
        time.setUTCMonth(Number(value.slice(0,2)));
        time.setUTCDate(Number(value.slice(2,4)));
        time.setUTCHours(Number(value.slice(4,6)));
        time.setUTCMinutes(Number(value.slice(6,8)));
        time.setUTCSeconds(0);
        time.setUTCMilliseconds(0);
    }
  }
  return time;
};

Packet.encodeTime = function(value, format) {
  var time = '';
  switch(format) {
    case 'HMS':
      // Hour
      var token = value.getUTCHours().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      // Minute
      token = value.getUTCMinutes().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      // Second
      token = value.getUTCSeconds().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      time += 'h';
      break;
    case 'MDHM':
      // Month
      var token = value.getUTCMonth().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      // Date
      var token = value.getUTCDate().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      // Hour
      token = value.getUTCHours().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      // Minute
      token = value.getUTCMinutes().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      break;
    case 'DHML':
      // Date
      var token = value.getDate().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      // Hour
      token = value.getHours().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      // Minute
      token = value.getMinutes().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      time += '/';
      break;
    case 'DHMZ':
    default:
      // Date
      var token = value.getUTCDate().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      // Hour
      token = value.getUTCHours().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      // Minute
      token = value.getUTCMinutes().toString();
      if(token.length < 2) {
        token = '0' + token;
      }
      time += token;
      time += 'z';
  }
  return time;
};

Packet.base91decode = function(value) {
  var ret = 0;
  var len = value.length;
  for(var n = 0; n < len; n++) {
    var x = value.charCodeAt(len - n - 1) - 33;
    ret += x * Math.pow(91, n);
  }
  return ret;
};

Packet.base91encode = function(value) {
  var ret = '';
  var n = 1;
  while(Math.pow(91, n) <= value) {
    n++;
  }
  for(; n >= 1; n--) {
    var div = Math.pow(91, n - 1);
    var x = Math.floor(value / div);
    value = value % div;
    ret += String.fromCharCode(x + 33);
  }
  return ret;
};

module.exports = Packet;
