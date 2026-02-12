declare module "upnpjs" {
  /** Options for adding a port mapping */
  export interface AddPortMappingOptions {
    ip: string;
    internalPort: number;
    externalPort: number;
    protocol?: "TCP" | "UDP";
    description?: string;
    enabled?: boolean;
  }

  /** Options for deleting a port mapping */
  export interface DeletePortMappingOptions {
    externalPort: number;
    protocol?: "TCP" | "UDP";
  }

  /** A single port mapping entry */
  export interface PortMapping {
    externalPort: number;
    internalPort: number;
    internalClient: string;
    protocol: "TCP" | "UDP";
    description: string;
    enabled: boolean;
    leaseDuration?: number;
  }

  /** Internet Gateway Device returned by discover() */
  export interface InternetGatewayDevice {
    addPortMapping(options: AddPortMappingOptions): Promise<boolean>;
    deletePortMapping(options: DeletePortMappingOptions): Promise<void>;

    getExternalIPAddress(): Promise<string>;

    getPortMappingList(): Promise<PortMapping[]>;

    getPortMapping(index: number): Promise<PortMapping>;
  }

  /** Discover the Internet Gateway Device */
  export function discover(): Promise<InternetGatewayDevice>;
}
