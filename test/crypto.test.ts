import { RiscoCrypt } from '../src/RiscoCrypt';

describe('Crypto tests', () => {
  it('Test correct Buffer', () => {
    testAndLogBuffer(2, 17, 49, 49, 81, 67, 118, 14, 248, 80, 197, 223, 234, 147, 118, 184, 43, 38, 36, 122, 128, 98, 246, 152, 83, 148, 93, 217, 129, 118, 142, 47, 42, 54, 94, 200, 242, 215, 218, 200, 137, 71, 206, 203, 3);
  });

  it('Test incorrect Buffer', () => {
    testAndLogBuffer(2, 17, 49, 48, 81, 71, 110, 12, 233, 92, 222, 217, 231, 155, 112, 177, 54, 39, 29, 106, 133, 91, 230, 157, 106, 189, 89, 224, 145, 115, 183, 63, 47, 15, 119, 204, 203, 199, 223, 239, 143, 79, 207, 246, 207, 204, 201, 194, 213, 250, 165, 27, 95, 157, 104, 128, 80, 241, 179, 54, 60, 16, 16, 16, 3, 84, 248, 160, 16, 16, 113, 178, 53, 16, 2, 38, 31, 111, 142, 77, 202, 197, 218, 220, 155, 101, 154, 100, 152, 97, 146, 116, 159, 41, 16, 16, 127, 202, 3);
  });

  it('Test unencrypted command', () => {
    testAndLogBuffer(2,48,50,65,67,75,23,51,57,65,70,3);
  });

  it('Test https://github.com/vanackej/risco-mqtt-local/issues/20', () => {
    testAndLogBuffer(2,17,50,54,72,66,124,10,241,41,160,213,224,228,12,190,59,95,121,97,133,34,154,150,106,252,61,235,145,22,204,52,47,108,46,198,203,167,163,228,143,56,173,196,206,190,171,201,213,152,192,16,16,102,226,20,139,80,135,209,61,60,90,124,95,248,212,107,122,178,70,81,44,31,30,235,70,202,161,162,194,154,22,239,16,16,3)
  });

  it('Test https://github.com/vanackej/risco-lan-bridge/issues/4', () => {
    testAndLogBuffer(2,17,50,54,69,39,26,73,132,76,192,217,3)
  });

  it('One shot test', () => {
    guessAllPossiblesPanelsIdAndEncodings(2,17,50,48,88,78,124,18,255,54,201,187,169,210,54,109,102,115,13,9,92,8,163,223,51,192,129,199,150,119,197,75,3)
    // guessAllPossiblesPanelsId(2,17,50,54,81,91,109,18,151,75,206,208,237,242,35,233,100,120,13,122,149,75,246,141,122,148,72,240,129,74,196,122,118,76,23,147,158,215,207,255,159,95,223,223,222,220,240,191,128,176,239,74,56,197,54,213,64,225,163,38,44,57,18,109,155,229,73,53,231,37,43,55,15,127,158,93,218,213,202,245,163,22,194,53,197,51,208,33,168,32,16,3,102,172,56,17,66,229,131,86,66,52,198,53,221,59,156,74,211,198,236,184,17,66,229,131,93,74,58,192,120,145,67,230,173,59,22,77,250,148,73,242,172,9,253,75,56,201,36,200,122,149,74,244,136,112,128,96,161,21,65,49,34,99,3)
  });


});

function guessAllPossiblesPanelsIdAndEncodings(...items: number[]) {
  const buffer = Buffer.from(items);
  let encodings: BufferEncoding[] = ['utf-8', 'latin1']
  const panelsAndEncoding = []
  for (let i = 0; i < 9999; i++) {

    for (let e = 0; e < encodings.length; e++) {
      const rCrypt = new RiscoCrypt({
        encoding: encodings[e], panelId: i,
      });
      const decodeResult = rCrypt.decodeMessage(buffer);
      if (decodeResult[2]) {
        panelsAndEncoding.push({ panelId: i, encoding: encodings[e]})
      }
    }
  }
  console.log(`possible panels: ${JSON.stringify(panelsAndEncoding)}`);
}

function testAndLogBuffer(...items: number[]) {
  const rCrypt = new RiscoCrypt({
    encoding: 'latin1', panelId: 1,
  });
  const buffer = Buffer.from(items);
  const decodeResult = rCrypt.decodeMessage(buffer);
  console.log(decodeResult);
  expect(decodeResult[2]).toBe(true)
}
