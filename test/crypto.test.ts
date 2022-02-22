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
    testAndLogBuffer(2,17,55,48,72,91,96,29,246,71,198,218,255,145,112,170,57,38,31,104,149,90,226,151,106,129,127,226,228,122,177,3)
  });


});

function testAndLogBuffer(...items: number[]) {
  const rCrypt = new RiscoCrypt({
    encoding: 'utf-8', panelId: 1,
  });
  const buffer = Buffer.from(items);
  const decodeResult = rCrypt.decodeMessage(buffer);
  console.log(decodeResult);
  expect(decodeResult[2]).toBe(true)
}
