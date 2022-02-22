import { RiscoCrypt } from '../src/RiscoCrypt';

describe('Crypto tests', () => {
  it('Test buffers CRC', () => {

    const rCrypt = new RiscoCrypt({
      encoding: 'utf-8', panelId: 1,
    });

    const receivedBufferFail = Buffer.of(2, 17, 50, 54, 72, 66, 124, 10, 241, 41, 160, 213, 224, 228, 12, 190, 59, 95, 121, 97, 133, 34, 154, 150, 106, 252, 61, 235, 145, 22, 204, 52, 47, 108, 46, 198, 203, 167, 163, 228, 143, 56, 173, 196, 206, 190, 171, 201, 213, 152, 192, 16, 16, 102, 226, 20, 139, 80, 135, 209, 61, 60, 90, 124, 95, 248, 212, 107, 122, 178, 70, 81, 44, 31, 30, 235, 70, 202, 161, 162, 194, 154, 22, 239, 16, 16, 3);
    const receivedBufferSuccess = Buffer.of(2, 17, 54, 50, 72, 66, 124, 10, 241, 41, 160, 213, 224, 228, 12, 190, 59, 95, 121, 97, 133, 34, 154, 150, 106, 252, 61, 235, 145, 22, 204, 52, 47, 108, 46, 198, 203, 167, 163, 228, 143, 56, 173, 196, 206, 190, 171, 201, 213, 152, 192, 16, 16, 102, 226, 20, 139, 80, 135, 209, 61, 60, 90, 124, 95, 248, 212, 107, 122, 178, 70, 81, 44, 31, 30, 235, 70, 202, 161, 162, 194, 146, 23, 239, 17, 3);

    const decodedFailed = rCrypt.decodeMessage(receivedBufferFail);
    console.log(decodedFailed);

    const decodedSuccess = rCrypt.decodeMessage(receivedBufferSuccess);
    console.log(decodedSuccess);
  });

});
