declare module 'qrcode' {
  export function toDataURL(text: string): Promise<string>;
  export function toBuffer(text: string): Promise<Buffer>;
  export function toString(text: string): Promise<string>;
}
