import * as path from "path";
import { spawnSync } from "child_process";

const validator = [
    "import sys",
    "from lxml import etree",
    "parser = etree.XMLParser(resolve_entities=False, no_network=True)",
    "schema = etree.XMLSchema(etree.parse(sys.argv[1], parser))",
    "document = etree.fromstring(sys.stdin.buffer.read(), parser)",
    "schema.assertValid(document)",
].join("\n");

export function validateOtxml(xml: string, pythonExecutable = "python"): void {
    const schema = path.resolve(__dirname, "..", "schema", "sst.xsd");
    const result = spawnSync(pythonExecutable, ["-c", validator, schema], {
        input: xml, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) throw new Error(`Cannot run Python for OTXML XSD validation: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`OTXML XSD validation failed (Python with lxml is required): ${result.stderr.trim()}`);
}
