# OTXML generator

Independent draft generator: versioned common-data JSON -> OTXML -> XSD
validation. It does not import the IFC converter and does not read IFC, PDF, or
STAAD files. Those sources will need separate readers that produce common data.

## Requirements and usage

- Node.js 18+ and npm.
- Python on `PATH` as `python`, with `lxml` installed. Python is used to
  validate every generated document against the included XSD; a missing
  validator or validation failure stops generation.
- The lockfile uses the configured Bentley npm mirror; fresh installs may
  require access and authentication. Cached dependencies can be installed
  offline using `npm ci --offline`.

```powershell
Set-Location D:\projects\otxml-generator
npm ci
python -m pip install lxml
npm test
npm run generate -- ".\examples\746-common-data.json" "C:\data\generated.otxml"
# For IFC-derived common data and the existing connector reader:
npm run generate -- "C:\data\tower.json" "C:\data\tower.otxml" --connector
```

The output must not already exist. After `npm run build`, the CLI can also be
run without rebuilding: `node .\dist\cli.js input.json output.otxml`.

## API

```js
const fs = require("fs");
const { generateOtxml } = require(".");

const data = JSON.parse(fs.readFileSync("input.json", "utf8"));
const { xml, warnings } = generateOtxml(data);
fs.writeFileSync("output.otxml", xml, { flag: "wx" });
console.log(warnings);
```

The optional second argument `{ pythonExecutable: "...", connector: true }`
selects a Python
executable for API callers. Invalid data, unsupported features, unavailable
Python/lxml, and XSD violations throw errors rather than producing output.
`connector: true` (CLI `--connector`) uses the existing IFC converter's
`PanelProperty` element and root order. The default retains the original
sample's `Panel` element and order.

## Current common-data draft

[model.ts](./src/model.ts) defines `1.0-draft`; the provided
[example](./examples/746-common-data.json) maps the supplied OTXML. The sample
contains project/tower data, two panels, 21 members, 51 nodes and 53 sections.
Original attribute strings are retained in optional `sourceAttributes`: common
fields take precedence when edited, while unmapped attributes are preserved.
Equivalent numeric source strings are kept unchanged. Panel/face/segment
hierarchy and member references are explicit; unused nodes and sections remain.

The generator recreates the supplied OTXML's **element order, names, attributes,
and values**, not its original whitespace, quote style, or XML declaration
formatting. When source attributes are absent, source-only fields cannot be
reconstructed. In particular, output without them has not been proven to meet
all connector requirements.

The IFC reader emits the same `1.0-draft` model, including optional contour,
materials, releases, provenance and explicit partial-export metadata. Its
TypeScript copy of the model must evolve in step with this package until the
contract is extracted into a shared package.

The draft also supports member materials and releases, material property
provenance and section contours for IFC-derived X. It rejects plan/hip bracing
and unsupported fields rather than silently dropping them. Units must be
Y-up nodes in metres, panel and tower
dimensions in feet, and section dimensions in inches; the generator does not
perform unit conversions. The example's unit assumptions require confirmation
for other sources. Unknown weight units and other unmapped source attributes are
preserved but are not interpreted. Expand the model and mappings explicitly
before adding new sources or formats.

The source declares 46 panels but contains two, and section 3 has negative
dimensions. Both are preserved and reported as warnings; missing panels or
engineering values are never invented.

[schema/otxml.xsd](./schema/otxml.xsd) is the compatibility schema extended
from the supplied XSD. It accepts known root elements in any order and many
attributes are optional strings. XSD validation does **not** establish geometric,
structural, engineering, or complete connector correctness.
