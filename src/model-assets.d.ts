declare module 'virtual:model-assets' {
  const manifest: {
    visuals: Record<string, string[]>;
    compressed: Record<string, string>;
  };
  export default manifest;
}

declare module 'jsdom' {
  export class JSDOM {
    constructor(content: string, options: { contentType: string });
    window: { document: Document };
  }
}
