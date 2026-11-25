const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { xml2js } = require("xml-js");
const { generateOtxml } = require("../dist");
const { validateOtxml } = require("../dist/xsd");

const root = path.resolve(__dirname, "..");
const samplePath = path.join(root, "examples", "746-common-data.json");
const sample = () => JSON.parse(fs.readFileSync(samplePath, "utf8"));
const parse = (xml) => xml2js(xml, { compact: false }).elements[0];

function find(node, name) {
    if (node.name === name) return node;
    for (const child of node.elements || []) {
        const result = find(child, name);
        if (result) return result;
    }
}

function monopoleSample() {
    return {
        schemaVersion: "1.1-draft",
        source: { format: "IFC", fileName: "monopole.ifc" },
        units: {
            nodeCoordinates: { unit: "m" }, towerDimensions: { unit: "ft" },
            sectionDimensions: { unit: "in" }, poleDimensions: { unit: "unknown" },
        },
        coordinateSystem: { upAxis: "Y" },
        projectData: { projectId: "1", location: { latitudeDegrees: 44.1, longitudeDegrees: -72.9, altitudeMetres: 682 },
            sourceAttributes: { ComponentName: "ProjectData", SourceAppElementId: "ProjectData_1", Site_Lattitude: "44.1" } },
        towerInformation: { id: "tower", name: "Pole & Tower", type: "Monopole", height: 98.68, bearingAngleDegrees: 0,
            topFaceWidth: 2.33, topFaceDepth: 2.33, bottomFaceWidth: 3.9, bottomFaceDepth: 3.9,
            orientation: "OpenTower", otxmlAngle: 0, sourceAttributes: { ComponentName: "TowerInformation", OTXMLAngle: "0" },
            memberGroups: [{ id: "radcenters", type: "RadCenters", label: "RadCenters", members: [], memberGroups: [
                { id: "rad1", type: "RadCenter", label: "Elev", members: [],
                    sourceAttributes: { Elevation: "94.55", Operator: "-", SourceAppElementId: "Elevation:94.55" } },
            ] }] },
        poles: [{ id: "1", label: "Pole 1", sourceIfcId: "3081", parentIfcId: "262", sourceElementId: "IFC_pole",
            members: ["3081"], sectionLength: 98.68, topElevation: 98.68, bottomElevation: 0,
            topFlatDiameter: 2.33, bottomFlatDiameter: 3.9, topTipDiameter: 2.35, bottomTipDiameter: 3.92,
            thickness: 0.02, sectionType: "Tapered", topFlatWidth: 0, bottomFlatWidth: 0, sectionProfile: "TT508" }],
        nodes: [{ id: "1", x: -0.126, y: 30.07, z: -0.0105 }, { id: "2", x: 0, y: 0, z: 0 }],
        members: [{ id: "3081", sourceKind: "pole", label: "Pole 1", sourceElementId: "IFC_pole", startNodeId: "1", endNodeId: "2" }],
        sections: [], materials: [],
    };
}

test("generates monopole properties, shared pole members and rad centers under the monopole XSD", () => {
    const data = monopoleSample();
    const before = JSON.stringify(data);
    const result = generateOtxml(data);
    const tree = parse(result.xml);
    assert.equal(JSON.stringify(data), before);
    assert.deepEqual(tree.elements.map((entry) => entry.name),
        ["ProjectData", "TowerInformation", "Nodes", "PoleProperties", "Pole", "RadCenterProperties"]);
    assert.deepEqual(find(tree, "PhysicalMember").attributes,
        { PolePropertyID: "1", ID: "3081", StartNodeID: "1", EndNodeID: "2", Label: "Pole 1" });
    assert.equal(find(tree, "PoleProperty").attributes.Thickness, "0.02");
    assert.equal(find(tree, "PoleProperty").attributes.PolesectionType, "Tapered");
    assert.equal(find(tree, "RadCenterProperty").attributes.Elevation, "94.55");
    assert.equal(find(tree, "TowerInformation").attributes.TowerName, "Pole & Tower");
    assert.equal(find(tree, "Panel"), undefined);
    assert.equal(find(tree, "Sections"), undefined);
    assert(result.warnings.some((warning) => warning.includes("units are unknown")));
    assert(result.warnings.some((warning) => warning.includes("SectionID was omitted")));
    assert(result.warnings.some((warning) => warning.includes("Orientation")));
    assert.throws(() => validateOtxml(result.xml), /XSD validation failed/);
    validateOtxml(result.xml, "python", "monopole");
});

test("validates monopole pole, node, section, and member references", () => {
    const cases = [
        [(d) => { delete d.poles[0].members; }, /poles\[0\]\.members/],
        [(d) => { d.poles[0].members = ["missing"]; }, /Missing referenced member/],
        [(d) => { d.poles.push({ ...d.poles[0] }); }, /Duplicate poles ID|Duplicate member reference/],
        [(d) => { d.members[0].endNodeId = "missing"; }, /missing node/],
        [(d) => { d.members[0].endNodeId = "1"; }, /identical pole endpoints/],
        [(d) => { d.members[0].sectionId = "missing"; }, /missing section/],
        [(d) => { d.poles[0].thickness = "bad"; }, /thickness must be a finite number/],
        [(d) => { d.panels = [{}]; }, /cannot contain panels/],
        [(d) => { d.units.poleDimensions.unit = "m"; }, /unit conversion/],
        [(d) => { d.sections.push({ id: "1", shape: "LShape", dimensions: {}, contour: [{ polygonId: "1", x: 0, y: 0, z: 0 }] }); }, /cannot be represented/],
    ];
    for (const [mutate, error] of cases) {
        const data = monopoleSample();
        mutate(data);
        assert.throws(() => generateOtxml(data), error);
    }
});

test("writes multiple poles and explicit section references without inventing sections", () => {
    const data = monopoleSample();
    data.sections.push({ id: "section", shape: "HollowCircle", dimensions: { Radius: 1 } });
    data.members[0].sectionId = "section";
    data.poles.push({ ...data.poles[0], id: "2", label: "Pole 2", members: ["member2"] });
    data.members.push({ id: "member2", label: "Pole 2", startNodeId: "2", endNodeId: "1", betaAngleDegrees: 12 });
    const result = generateOtxml(data);
    const tree = parse(result.xml);
    const poles = tree.elements.filter((entry) => entry.name === "Pole");
    assert.equal(poles.length, 2);
    assert.equal(poles[0].elements[0].attributes.SectionID, "section");
    assert.equal(poles[1].elements[0].attributes.PolePropertyID, "2");
    assert.equal(poles[1].elements[0].attributes.BetaAngle, "12");
    assert.equal(poles[1].elements[0].attributes.SectionID, undefined);
    assert.equal(find(tree, "Section").attributes.ID, "section");
});

test("reports omitted rad centers instead of guessing elevations", () => {
    const data = monopoleSample();
    delete data.towerInformation.memberGroups[0].memberGroups[0].sourceAttributes.Elevation;
    const result = generateOtxml(data);
    assert.equal(find(parse(result.xml), "RadCenterProperties"), undefined);
    assert(result.warnings.some((warning) => warning.includes("no valid elevation")));
});

test("CLI selects the monopole schema for monopole JSON", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "otxml-pole-"));
    const input = path.join(directory, "input.json");
    const output = path.join(directory, "output.otxml");
    try {
        fs.writeFileSync(input, JSON.stringify(monopoleSample()));
        const run = spawnSync(process.execPath, [path.join(root, "dist", "cli.js"), input, output], { encoding: "utf8" });
        assert.equal(run.status, 0, run.stderr);
        assert.equal(find(parse(fs.readFileSync(output, "utf8")), "PhysicalMember").attributes.PolePropertyID, "1");
    } finally {
        for (const file of [input, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.rmdirSync(directory);
    }
});

test("generates connector-layout OTXML and validates it against the XSD", () => {
    const data = sample();
    const result = generateOtxml(data);
    const tree = parse(result.xml);
    assert.deepEqual(tree.elements.map((element) => element.name), [
        "Sections", ...(data.materials.length ? ["Materials"] : []), "Nodes", "PanelProperties",
        ...data.panels.map(() => "Panel"), "ProjectData", "TowerInformation",
    ]);
    assert.equal(find(tree, "PanelProperty").name, "PanelProperty");
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
    const xml = parse(generateOtxml(data).xml);
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

function planBracingSample() {
    const data = sample();
    data.schemaVersion = "1.1-draft";
    const panel = data.panels[0];
    const id = panel.legs[0].members.shift();
    const member = data.members.find((entry) => entry.id === id);
    delete member.sectionId;
    member.sourceAttributes.SectionID = "stale";
    member.extractionIssues = ["Missing section."];
    panel.planBracing = "TRIANGULAR Portal";
    panel.memberGroups = [{ id: "9510", type: "PlanBracing", label: "PlanBracing 1", members: [id] }];
    data.towerInformation.memberGroups = [{ id: "9000", type: "BaseStructure", label: "Base", members: [], propertySets: [
        { name: "Future", properties: [{ name: "Factors", type: "IFCPROPERTYLISTVALUE", value: [1, null, true] }] },
    ] }];
    return { data, panel, member };
}

test("1.1-draft writes plan bracing and defaults only missing section assignments", () => {
    const { data, member } = planBracingSample();
    const assigned = data.members.find((entry) => entry.sectionId !== undefined && entry.sectionId !== "1");
    assert(assigned);
    const result = generateOtxml(data);
    const tree = parse(result.xml);
    const details = find(tree, "PlanBracingDetails");
    const group = details.elements[0];
    assert.equal(group.name, "PlanBracing");
    assert.deepEqual(group.attributes, { ID: "9510", Name: "PlanBracing 1" });
    assert.equal(group.elements[0].name, "PhysicalMember");
    assert.equal(group.elements[0].attributes.ID, member.id);
    assert.equal(group.elements[0].attributes.SectionID, "1");
    assert.equal(find(tree, "PanelProperty").attributes.PlanBracing, "TRIANGULAR Portal");
    assert.match(result.xml, new RegExp(`<PhysicalMember[^>]*\\bID="${assigned.id}"[^>]*\\bSectionID="${assigned.sectionId}"`));
    assert.equal(member.sectionId, undefined);
    assert(result.warnings.some((warning) => warning.includes('default SectionID="1" for 1 members')));
    assert(result.warnings.some((warning) => warning.includes("remain in Common X")));
});

test("1.1-draft rejects missing fallback definitions, invalid references, and unmapped groups containing members", () => {
    const cases = [
        [({ data }) => { data.sections = data.sections.filter((section) => section.id !== "1"); }, /default section 1 is not defined/],
        [({ member }) => { member.sectionId = "does-not-exist"; }, /references a missing section/],
        [({ panel }) => { panel.memberGroups[0].members = ["does-not-exist"]; }, /Missing referenced member/],
        [({ panel }) => { panel.memberGroups[0].type = "FutureType"; }, /plan bracing is declared|cannot represent members/],
    ];
    for (const [mutate, error] of cases) {
        const fixture = planBracingSample();
        mutate(fixture);
        assert.throws(() => generateOtxml(fixture.data), error);
    }
});

test("ignores support members and support-only nodes but preserves shared tower nodes", () => {
    const data = sample();
    data.schemaVersion = "1.1-draft";
    const id = data.panels[0].legs[0].members.shift();
    const member = data.members.find((entry) => entry.id === id);
    delete member.betaAngleDegrees;
    delete member.sectionId;
    delete member.propertySets;
    const sharedNode = data.members.find((entry) => entry.id !== id).startNodeId;
    member.endNodeId = sharedNode;
    member.startNodeId = "support-only-node";
    data.nodes.push({ id: "support-only-node", x: 1, y: 2, z: 3 });
    data.towerInformation.memberGroups = [{ id: "supports", type: "Supports", label: "Supports", members: [id] }];
    data.sections.find((section) => section.id === "1").contour = [{ polygonId: "1", x: 0, y: 0, z: 1 }];
    const before = JSON.stringify(data);
    const result = generateOtxml(data);
    const tree = parse(result.xml);
    assert.equal(JSON.stringify(data), before);
    assert.equal(find(tree, "Support"), undefined);
    assert.equal(find(tree, "Supports"), undefined);
    assert.equal(find(tree, "SupportMember"), undefined);
    assert.equal(find(tree, "SupportSections"), undefined);
    assert.equal(find(tree, "SupportSection"), undefined);
    assert.equal(find(tree, "SupportPolyLine"), undefined);
    assert.equal(find(tree, "SupportNodes"), undefined);
    const nodes = find(tree, "Nodes").elements.map((entry) => entry.attributes.ID);
    assert(!nodes.includes("support-only-node"));
    assert(nodes.includes(sharedNode));
    assert(result.warnings.some((warning) => warning.includes("Ignored 1 support members")));
    assert(!result.warnings.some((warning) => warning.includes("default SectionID")));
    assert(find(tree, "Sections").elements.some((entry) => entry.name === "Section" && entry.attributes.ID === "1"));
});

test("CLI writes validated output without overwriting existing files", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "otxml-generator-"));
    const output = path.join(directory, "output.otxml");
    try {
        const run = (...args) => spawnSync(process.execPath, [path.join(root, "dist", "cli.js"), samplePath, output, ...args], { encoding: "utf8" });
        const first = run();
        assert.equal(first.status, 0, first.stderr);
        assert.equal(find(parse(fs.readFileSync(output, "utf8")), "PanelProperty").name, "PanelProperty");
        const second = run();
        assert.notEqual(second.status, 0);
        assert.match(second.stderr, /EEXIST/);
        assert.equal(find(parse(fs.readFileSync(output, "utf8")), "PanelProperty").name, "PanelProperty");
        const flag = run("--connector");
        assert.notEqual(flag.status, 0);
        assert.match(flag.stderr, /Usage: otxml-generator input\.json output\.otxml/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
