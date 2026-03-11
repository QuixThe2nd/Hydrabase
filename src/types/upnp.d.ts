declare module "upnpjs" {
  /** Options for adding a port mapping */
  export interface AddPortMappingOptions {
    description?: string;
    enabled?: boolean;
    externalPort: number;
    internalPort: number;
    ip: string;
    protocol?: "TCP" | "UDP";
  }

  /** Options for deleting a port mapping */
  export interface DeletePortMappingOptions {
    externalPort: number;
    protocol?: "TCP" | "UDP";
  }

  /** Internet Gateway Device returned by discover() */
  export interface InternetGatewayDevice {
    addPortMapping(options: AddPortMappingOptions): Promise<boolean>;
    deletePortMapping(options: DeletePortMappingOptions): Promise<void>;

    getExternalIPAddress(): Promise<string>;

    getPortMapping(index: number): Promise<PortMapping>;

    getPortMappingList(): Promise<PortMapping[]>;
  }

  /** A single port mapping entry */
  export interface PortMapping {
    description: string;
    enabled: boolean;
    externalPort: number;
    internalClient: string;
    internalPort: number;
    leaseDuration?: number;
    protocol: "TCP" | "UDP";
  }

  /** Discover the Internet Gateway Device */
  export function discover(): Promise<InternetGatewayDevice>;
}
