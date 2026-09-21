declare module 'qrcode' {
  export interface QRCodeToDataURLOptions {
    width?: number;
    margin?: number;
    color?: { dark?: string; light?: string };
    type?: string;
    errorCorrectionLevel?: string;
  }
  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  export function toBuffer(text: string, options?: QRCodeToDataURLOptions): Promise<Buffer>;
  export function toString(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
}
