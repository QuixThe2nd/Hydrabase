declare module "@iplookup/country" {
  export interface IpLookupResult {
    [key: string]: unknown;
    country?: string;
  }

  export default function ipLookup(ip: string): Promise<IpLookupResult | null>
}
