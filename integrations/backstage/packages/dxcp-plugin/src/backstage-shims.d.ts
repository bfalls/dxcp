declare module "@backstage/core-components" {
  import * as React from "react";

  export const InfoCard: React.ComponentType<{ title: string; children?: React.ReactNode }>;
  export const Progress: React.ComponentType;
  export const WarningPanel: React.ComponentType<{ title?: string; children?: React.ReactNode }>;
  export const Link: React.ComponentType<
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }
  >;
}

declare module "@backstage/core-plugin-api" {
  export const configApiRef: unknown;
  export function useApi<T>(apiRef: unknown): T;

  export type Config = {
    getOptionalString(path: string): string | undefined;
  };
}

declare module "@backstage/catalog-model" {
  export type Entity = {
    metadata?: {
      annotations?: Record<string, string>;
    };
  };
}

declare module "@backstage/plugin-catalog-react" {
  import { Entity } from "@backstage/catalog-model";

  export function useEntity(): { entity: Entity };
}
