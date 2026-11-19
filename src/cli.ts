#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { generateOtxml } from "./index";

function main(args: string[]): void {
    if ((args.length !== 2 && !(args.length === 3 && args[2] === "--connector")) ||
        !args[0] || !args[1] || args[0].startsWith("--") || args[1].startsWith("--")) {
        throw new Error("Usage: otxml-generator input.json output.otxml [--connector]");
    }
    const [input, output] = args;
    if (path.resolve(input).toLowerCase() === path.resolve(output).toLowerCase()) throw new Error("Output must not overwrite input.");
    const data: unknown = JSON.parse(fs.readFileSync(input, "utf8"));
    const result = generateOtxml(data, { connector: args[2] === "--connector" });
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    fs.writeFileSync(output, result.xml, { encoding: "utf8", flag: "wx" });
    console.log(`Created ${output} (XSD validated).`);
}

try {
    main(process.argv.slice(2));
} catch (error) {
    console.error("OTXML generation failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
