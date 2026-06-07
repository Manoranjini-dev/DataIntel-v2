// Minimal ambient declarations for oracledb (no @types/oracledb available)
declare module 'oracledb' {
  export const OUT_FORMAT_OBJECT: number;
  export function getConnection(params: {
    user: string;
    password: string;
    connectString: string;
  }): Promise<Connection>;

  export interface Connection {
    callTimeout: number;
    execute(sql: string, params?: any, options?: any): Promise<{ rows?: any[]; metaData?: Array<{ name: string }> }>;
    close(): Promise<void>;
  }
}
