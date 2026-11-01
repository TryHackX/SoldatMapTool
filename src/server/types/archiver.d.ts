// archiver 8 is ESM with class exports and ships no type definitions (@types/archiver describes the old
// `archiver('zip')` factory). Only the members this project uses are declared.
declare module 'archiver' {
  import { Readable, Transform } from 'stream';

  export interface ArchiverEntryData {
    name: string;
    date?: Date | string;
    mode?: number;
    prefix?: string;
  }

  export interface ArchiverOptions {
    zlib?: { level?: number };
    store?: boolean;
    comment?: string;
    forceLocalTime?: boolean;
    forceZip64?: boolean;
  }

  export class Archiver extends Transform {
    append(source: Readable | Buffer | string, data: ArchiverEntryData): this;
    file(filepath: string, data: ArchiverEntryData): this;
    finalize(): Promise<void>;
    abort(): this;
    pointer(): number;
  }

  export class ZipArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }
}
