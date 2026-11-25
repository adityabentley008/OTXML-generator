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
npm run generate -- "C:\data\tower.json" "C:\data\tower.otxml"
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

The optional second argument `{ pythonExecutable: "..." }` selects a Python
executable for API callers. Invalid data, unsupported features, unavailable
Python/lxml, and XSD violations throw errors rather than producing output.
The generator selects `sst.xsd` or `monopole.xsd` from `towerInformation.type`.
SST output uses the connector-compatible `PanelProperty` layout; there is no
layout-selection option.

## Supported common-data drafts

[model.ts](./src/model.ts) supports `1.0-draft` and `1.1-draft`; the provided
[example](./examples/746-common-data.json) maps the supplied OTXML. The sample
contains project/tower data, two panels, 21 members, 51 nodes and 53 sections.
Original attribute strings are retained in optional `sourceAttributes`: common
fields take precedence when edited, while unmapped attributes are preserved.
Equivalent numeric source strings are kept unchanged. Panel/face/segment
hierarchy and member references are explicit; unused nodes and sections remain.

The generator recreates the supplied OTXML's **element names, attributes, and
values**, not its original whitespace, quote style, XML declaration formatting,
or top-level element order. It always emits the connector-compatible layout.
When source attributes are absent, source-only fields cannot be reconstructed.

For IFC-derived `1.1-draft`, panel `memberGroups` with `type: "PlanBracing"`
are serialized under `PlanBracingDetails`. Members without `sectionId` use
`SectionID="1"` with a warning, and section `1` must already exist in the
input. Explicit assignments must reference existing sections and are never
replaced. The fallback is not a recovered engineering assignment.

IFC property sets, group source attributes and unmapped groups without members
remain in Common X and are not written to OTXML. Unmapped groups containing
members and hip bracing fail explicitly. `1.0-draft` keeps its original
validation, including required section assignments and no plan/hip bracing.

Both drafts support member materials and releases, material property
provenance and section contours. Units must be
Y-up nodes in metres, panel and tower
dimensions in feet, and section dimensions in inches; the generator does not
perform unit conversions. The example's unit assumptions require confirmation
for other sources. Unknown weight units and other unmapped source attributes are
preserved but are not interpreted. Expand the model and mappings explicitly
before adding new sources or formats.

### Monopole towers

Common X `1.1-draft` monopoles use `poles`, each with `members` referencing
the shared top-level `members` and `nodes` collections, instead of panels.
The IFC extractor represents the original IFC Pole as a member; it does not
claim that a separate IFC beam exists. Re-extract older monopole JSON that has
pole endpoint IDs but no `members` list. Example:

```powershell
Set-Location D:\projects\ifc-to-otxml
npm run extract -- "D:\testIfcs\ifc4.ifc" "C:\data\monopole.json" --compact
Set-Location D:\projects\otxml-generator
npm run generate -- "C:\data\monopole.json" "C:\data\monopole.otxml"
```

Pole properties and referenced members are emitted in the order required by
[monopole.xsd](./schema/monopole.xsd). Members must reference existing,
distinct endpoint nodes. Missing section IDs and beta angles are omitted,
not defaulted. Pole dimensions with `unit: "unknown"` are passed through with
a warning; verify their units before use. Source rad centers with an elevation
are emitted, including after compact extraction; rad centers missing a valid
elevation are skipped with a warning. Other unmapped groups and IFC properties
remain in Common X rather than being invented as equipment.

The supplied monopole schema does not permit tower `Orientation`, pole
`SectionProfile`, member material/release attributes, or section contours.
The generator warns when applicable; contours are rejected. The connector may
use defaults for omitted values, so **XSD validation does not guarantee that
the resulting iModel matches the source**. In particular, orientation can
affect the connector's solid/hollow pole choice. Confirm the schema and units
before relying on rendered or engineering results.

### Support groups

Support output is temporarily disabled while its schema is being discussed.
In `1.1-draft`, `Support` and `Supports` member groups (including descendants)
may remain in Common X. Their members are ignored with a warning and nodes
used exclusively by those members are omitted. Nodes shared with tower members
are preserved. No support XML tags are generated, no support-specific fields
or section-1 fallback are required, and the input JSON is not modified.
Other unused nodes, sections and materials retain their existing behavior.

The source declares 46 panels but contains two, and section 3 has negative
dimensions. Both are preserved and reported as warnings; missing panels or
engineering values are never invented.

[schema/sst.xsd](./schema/sst.xsd) is the SST compatibility schema extended
from the supplied XSD. It accepts known root elements in any order and many
attributes are optional strings. XSD validation does **not** establish geometric,
structural, engineering, or complete connector correctness.
