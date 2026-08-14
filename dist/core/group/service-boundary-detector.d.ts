export interface ServiceBoundary {
    servicePath: string;
    serviceName: string;
    markers: string[];
    confidence: number;
}
export declare function detectServiceBoundaries(repoPath: string): Promise<ServiceBoundary[]>;
export declare function assignService(filePath: string, boundaries: ServiceBoundary[]): string | undefined;
