const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { xml2js } = require("xml-js");
const { generateOtxml } = require("../dist");

const root = path.resolve(__dirname, "..");
const samplePath = path.join(root, "examples", "746-common-data.json");
const sample = () => JSON.parse(fs.readFileSync(samplePath, "utf8"));
const parse = (xml) => xml2js(xml, { compact: false }).elements[0];
const original = fs.readFileSync(path.join(__dirname, "fixtures", "746_detect.xml"), "utf8");

function find(node, name) {
    if (node.name === name) return node;
    for (const child of node.elements || []) {
        const result = find(child, name);
        if (result) return result;
    }
}

test("reconstructs the complete source XML tree and validates it against the XSD", () => {
    const result = generateOtxml(sample());
    assert.deepEqual(parse(result.xml), parse(original));
    assert(result.warnings.some((warning) => warning.includes("46 panels") && warning.includes("2")));
    assert(result.warnings.some((warning) => warning.includes("Section 3")));
});

test("common values override source attributes and XML metacharacters round-trip", () => {
    const input = sample();
    input.projectData.siteName = "Changed & <site> \"one\"";
    input.nodes[0].x = 123.25;
    input.members[0].betaAngleDegrees = 42;
    input.sections[0].dimensions.Radius = 1.5;
    input.panels[0].label = "Changed";
    const xml = parse(generateOtxml(input).xml);
    assert.equal(find(xml, "ProjectData").attributes.SiteName, input.projectData.siteName);
    assert.equal(find(xml, "Node").attributes.X, "123.25");
    assert.equal(find(xml, "PhysicalMember").attributes.BetaAngle, "42");
    assert.equal(find(xml, "Section").attributes.Radius, "1.5");
    assert.equal(find(xml, "PanelProperties").elements[0].attributes.Label, "Changed");
    assert.equal(find(xml, "ProjectData").attributes.CustApplicationId, "OpenTower Connector");
});

test("rejects unsupported, incomplete and inconsistent input rather than discarding it", () => {
    const cases = [
        [(d) => { d.schemaVersion = "2.0"; }, /schemaVersion/],
        [(d) => { d.units.nodeCoordinates.unit = "ft"; }, /unit conversion/],
        [(d) => { d.members[0].startNodeId = "missing"; }, /missing node/],
        [(d) => { d.panels[0].legs[0].members.push("1"); }, /Duplicate member reference/],
        [(d) => { d.materials.push({ id: "1" }); }, /materials\[0\].name/],
        [(d) => { d.sections[0].dimensions.ID = 123; }, /Unsupported field/],
        [(d) => { d.extra = "not supported"; }, /Unsupported field/],
        [(d) => { d.projectData.sourceAttributes.Unknown = "value"; }, /XSD validation failed/],
    ];
    for (const [mutate, error] of cases) {
        const input = sample();
        mutate(input);
        assert.throws(() => generateOtxml(input), error);
    }
});

test("reports an unavailable XSD validator instead of returning unvalidated XML", () => {
    assert.throws(() => generateOtxml(sample(), { pythonExecutable: path.join(root, "no-such-python") }), /Cannot run Python/);
});

test("connector profile writes material assignments, contours and actual partial panel count", () => {
    const data = sample();
    delete data.projectData.siteName;
    delete data.towerInformation.tiltX;
    data.towerInformation.partialExport = true;
    data.sections[0].contour = [{ polygonId: "1", x: 0.1, y: 0, z: 0.2 }];
    data.materials.push({ id: "steel", name: "Default Steel", propertiesSource: "assumed", properties: [
        { name: "E", description: "E", value: "205000", unit: "N/mm2" },
    ] });
    data.members[0].materialId = "steel";
    data.members[0].materialAssignmentSource = "assumed";
    data.members[0].startRelease = "00000";
    const xml = parse(generateOtxml(data, { connector: true }).xml);
    assert.equal(xml.elements[0].name, "Sections");
    assert.equal(find(xml, "PanelProperty").attributes.PanelID, "T1");
    assert.equal(find(xml, "TowerInformation").attributes.NoofPanel, "2");
    assert.equal(find(xml, "TowerInformation").attributes.SourcePanelCount, "46");
    assert.equal(find(xml, "PolyLine").attributes.RefID, data.sections[0].id);
    assert.equal(find(xml, "PhysicalMember").attributes.MaterialID, "steel");
    assert.equal(find(xml, "PhysicalMember").attributes.StartRelease, "00000");
    assert.equal(find(xml, "MaterialProperty").attributes.Value, "205000");
    const broken = sample();
    broken.members[0].materialId = "missing";
    assert.throws(() => generateOtxml(broken), /missing material/);
    const hidden = sample();
    hidden.members[0].sourceAttributes.MaterialID = "missing";
    assert.throws(() => generateOtxml(hidden), /materialId is required/);
});

test("CLI writes validated output without overwriting existing files", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "otxml-generator-"));
    const output = path.join(directory, "output.otxml");
    try {
        const run = () => spawnSync(process.execPath, [path.join(root, "dist", "cli.js"), samplePath, output], { encoding: "utf8" });
        const first = run();
        assert.equal(first.status, 0, first.stderr);
        assert.deepEqual(parse(fs.readFileSync(output, "utf8")), parse(original));
        const second = run();
        assert.notEqual(second.status, 0);
        assert.match(second.stderr, /EEXIST/);
        assert.deepEqual(parse(fs.readFileSync(output, "utf8")), parse(original));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
