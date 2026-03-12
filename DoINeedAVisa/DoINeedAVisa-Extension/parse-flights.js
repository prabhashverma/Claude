// Google Flights URL parser — ported from DoINeedAVisa-Website/src/utils/parseGoogleFlightsUrl.ts

function readVarint(buf, offset) {
  var result = 0;
  var shift = 0;
  var pos = offset;
  while (pos < buf.length) {
    var byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7;
  }
  return [result, pos];
}

function parseProtoFields(buf) {
  var fields = [];
  var pos = 0;
  while (pos < buf.length) {
    var tagResult = readVarint(buf, pos);
    var tag = tagResult[0];
    pos = tagResult[1];
    var fieldNumber = tag >>> 3;
    var wireType = tag & 0x7;
    if (wireType === 0) {
      var valResult = readVarint(buf, pos);
      pos = valResult[1];
      fields.push({ fieldNumber: fieldNumber, wireType: wireType, value: valResult[0] });
    } else if (wireType === 2) {
      var lenResult = readVarint(buf, pos);
      var len = lenResult[0];
      pos = lenResult[1];
      fields.push({ fieldNumber: fieldNumber, wireType: wireType, value: buf.slice(pos, pos + len) });
      pos += len;
    } else if (wireType === 5) {
      pos += 4;
    } else if (wireType === 1) {
      pos += 8;
    } else {
      break;
    }
  }
  return fields;
}

function getProtoString(buf, targetField) {
  var fields = parseProtoFields(buf);
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (f.fieldNumber === targetField && f.wireType === 2) {
      try { return new TextDecoder().decode(f.value); } catch (e) { return null; }
    }
  }
  return null;
}

function getAllSubmessages(buf, targetField) {
  return parseProtoFields(buf)
    .filter(function (f) { return f.fieldNumber === targetField && f.wireType === 2; })
    .map(function (f) { return f.value; });
}

function isIataCode(s) {
  return /^[A-Z]{3}$/.test(s);
}

function isDateString(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Parse a Google Flights URL and extract flight legs.
 *
 * Protobuf structure (reverse-engineered):
 *   Root -> field 3 (repeated) = slices
 *     Slice -> field 2 = date, field 4 (repeated) = legs
 *       Leg -> field 1 = departure IATA, field 2 = date, field 3 = arrival IATA,
 *              field 5 = airline code, field 6 = flight number
 */
function parseGoogleFlightsUrl(url) {
  var urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    throw new Error('Invalid URL');
  }

  if (!urlObj.hostname.includes('google.com') || !urlObj.pathname.includes('/travel/flights')) {
    throw new Error('Not a Google Flights URL');
  }

  var tfs = urlObj.searchParams.get('tfs');
  if (!tfs) {
    throw new Error('No flight data found in URL (missing tfs parameter)');
  }

  // URL-safe base64 -> standard base64
  var b64 = tfs.replace(/-/g, '+').replace(/_/g, '/');
  var padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);

  var bytes;
  try {
    var binaryStr = atob(padded);
    bytes = new Uint8Array(binaryStr.length);
    for (var i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
  } catch (e) {
    throw new Error('Failed to decode flight data');
  }

  var sliceMessages = getAllSubmessages(bytes, 3);
  if (sliceMessages.length === 0) {
    throw new Error('No flights found in URL data');
  }

  var allFlights = [];
  var slices = [];

  for (var s = 0; s < sliceMessages.length; s++) {
    var sliceMsg = sliceMessages[s];
    var sliceDate = getProtoString(sliceMsg, 2) || '';
    var legMessages = getAllSubmessages(sliceMsg, 4);
    var sliceFlights = [];

    for (var l = 0; l < legMessages.length; l++) {
      var legMsg = legMessages[l];
      var departure = getProtoString(legMsg, 1) || '';
      var date = getProtoString(legMsg, 2) || sliceDate;
      var arrival = getProtoString(legMsg, 3) || '';
      var airline = getProtoString(legMsg, 5) || '';
      var flightNum = getProtoString(legMsg, 6) || '';

      if (isIataCode(departure) && isIataCode(arrival)) {
        var flight = {
          departure: departure,
          arrival: arrival,
          date: isDateString(date) ? date : '',
          airline: airline,
          flightNum: flightNum
        };
        sliceFlights.push(flight);
        allFlights.push(flight);
      }
    }

    if (sliceFlights.length > 0) {
      slices.push({ flights: sliceFlights });
    }
  }

  if (allFlights.length === 0) {
    throw new Error('Could not extract any flight legs from URL');
  }

  return { flights: allFlights, slices: slices };
}

function isGoogleFlightsUrl(text) {
  try {
    var u = new URL(text.trim());
    return u.hostname.includes('google.com') && u.pathname.includes('/travel/flights');
  } catch (e) {
    return false;
  }
}
