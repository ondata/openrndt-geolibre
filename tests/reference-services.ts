import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The reference services (#60): what tries of the plugin run against. The live checks are in live.test.ts. */
export interface ReferenceService {
  id: string;
  kind: "wms" | "wfs" | "arcgis";
  recordId: string;
  title: string;
  url: string;
  layer?: string;
  features?: number;
  bbox3857?: [number, number, number, number];
  cors: boolean;
  uses: string[];
  checked: string;
  note?: string;
}

export interface ReferenceFailure {
  id: string;
  url: string;
  uses: string[];
  checked: string;
  note?: string;
}

export const reference = JSON.parse(readFileSync(join(__dirname, "fixtures", "reference-services.json"), "utf8")) as {
  origin: string;
  services: ReferenceService[];
  failures: ReferenceFailure[];
};
