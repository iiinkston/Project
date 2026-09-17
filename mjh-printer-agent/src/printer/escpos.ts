import iconv from "iconv-lite";

const ESC = 0x1b;
const GS = 0x1d;

export function initialize(): Buffer {
  return Buffer.from([ESC, 0x40]);
}

export function alignLeft(): Buffer {
  return Buffer.from([ESC, 0x61, 0x00]);
}

export function alignCenter(): Buffer {
  return Buffer.from([ESC, 0x61, 0x01]);
}

export function boldOn(): Buffer {
  return Buffer.from([ESC, 0x45, 0x01]);
}

export function boldOff(): Buffer {
  return Buffer.from([ESC, 0x45, 0x00]);
}

export function normalSize(): Buffer {
  return Buffer.from([GS, 0x21, 0x00]);
}

export function doubleSize(): Buffer {
  return Buffer.from([GS, 0x21, 0x11]);
}

export function feed(lines: number): Buffer {
  const count = Math.max(0, Math.floor(lines));
  return Buffer.from([ESC, 0x64, count]);
}

export function fullCut(): Buffer {
  return Buffer.from([GS, 0x56, 0x00]);
}

export function textGB18030(text: string): Buffer {
  return iconv.encode(text, "gb18030");
}

export function lineGB18030(text: string = ""): Buffer {
  return Buffer.concat([textGB18030(text), Buffer.from([0x0a])]);
}
