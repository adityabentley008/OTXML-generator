import { Element, js2xml } from "xml-js";
import { CommonData, DEFAULT_SECTION_ID, Member, Panel, SourceAttributes } from "./model";
import { supportOnlyNodeIds } from "./supports";

type AttributeValue = string | number;

function mapped(original: SourceAttributes | undefined, values: Record<string, AttributeValue>): SourceAttributes {
    const result: SourceAttributes = { ...original };
    for (const [key, value] of Object.entries(values)) {
        const previous = original && original[key];
        result[key] = typeof value === "number" && previous !== undefined && previous.trim() !== "" && Number(previous) === value
            ? previous : String(value);
    }
    return result;
}

function element(name: string, attrs: SourceAttributes = {}, children: Element[] = []): Element {
    return { type: "element", name, attributes: attrs, elements: children };
}

function project(data: CommonData): Element {
    const p = data.projectData;
    const original = p.sourceAttributes;
    const attrs: Record<string, AttributeValue> = { ID: p.projectId };
    if (p.siteName !== undefined) attrs.SiteName = p.siteName;
    for (const [plain, underscored, value] of [
        ["SiteLattitude", "Site_Lattitude", p.location.latitudeDegrees],
        ["SiteLongitude", "Site_Longitude", p.location.longitudeDegrees],
        ["SiteAltitude", "Site_Altitude", p.location.altitudeMetres],
    ] as Array<[string, string, number]>) {
        if (!original || plain in original || !(underscored in original)) attrs[plain] = value;
        if (original && underscored in original) attrs[underscored] = value;
    }
    return element("ProjectData", mapped(original, attrs));
}

function tower(data: CommonData): Element {
    const t = data.towerInformation;
    const values: Record<string, AttributeValue> = {
        TowerID: t.id, TowerName: t.name, TowerType: t.type, TowerHeight: t.height,
        NoOfLegs: t.numberOfLegs, NoofPanel: t.partialExport ? data.panels.length : t.declaredPanelCount, BearingAngle: t.bearingAngleDegrees,
        TopFaceWidth: t.topFaceWidth, TopFaceDepth: t.topFaceDepth, BottomFaceWidth: t.bottomFaceWidth,
        BottomFaceDepth: t.bottomFaceDepth,
    };
    for (const [key, value] of Object.entries({ ConcreteHeight: t.concreteHeight, TowerTiltX: t.tiltX, TowerTiltY: t.tiltY, Convention: t.convention, UnitSystem: t.unitSystem, TowerShape: t.towerShape, OTXMLAngle: t.otxmlAngle, Orientation: t.orientation })) {
        if (value !== undefined) values[key] = value;
    }
    if (t.partialExport) { values.SourcePanelCount = t.declaredPanelCount; values.PartialExport = "True"; }
    return element("TowerInformation", mapped(t.sourceAttributes, values));
}

function panelProperty(panel: Panel): Element {
    return element("PanelProperty", mapped(panel.sourceAttributes && panel.sourceAttributes.panelProperty, {
        PanelID: panel.id, Label: panel.label, Height: panel.height, TopWidth: panel.topWidth,
        BottomWidth: panel.bottomWidth, TopElevation: panel.topElevation, BottomElevation: panel.bottomElevation,
        FaceBracing: panel.faceBracing, PlanBracing: panel.planBracing, HipBracing: panel.hipBracing,
        NumberOfSegments: panel.numberOfSegments, Weight: panel.weight,
    }));
}

function physicalMember(member: Member): Element {
    const original = { ...member.sourceAttributes };
    if (member.tag === undefined) delete original.MemberTag;
    const attrs: Record<string, AttributeValue> = {
        ID: member.id, StartNodeID: member.startNodeId, EndNodeID: member.endNodeId, SectionID: member.sectionId ?? DEFAULT_SECTION_ID,
        ...(member.betaAngleDegrees === undefined ? {} : { BetaAngle: member.betaAngleDegrees }), Label: member.label,
    };
    if (member.tag !== undefined) attrs.MemberTag = member.tag;
    for (const [key, value] of Object.entries({ MaterialID: member.materialId, StartRelease: member.startRelease, EndRelease: member.endRelease, SourceAppElementId: member.sourceElementId })) {
        if (value !== undefined) attrs[key] = value;
    }
    return element("PhysicalMember", mapped(original, attrs));
}

function panelElement(panel: Panel, members: Map<string, Member>): Element {
    const children = (ids: string[]): Element[] => ids.map((id) => {
        const member = members.get(id);
        if (!member) throw new Error(`Missing referenced member ${id}.`);
        return physicalMember(member);
    });
    const legs = element("Legs", {}, panel.legs.map((leg) => element("Leg", { Name: leg.name }, children(leg.members))));
    const faces = element("FaceBracingDetails", {}, panel.faces.map((face) =>
        element("Face", { ID: face.id, Name: face.name }, [element("Segments", {}, face.segments.map((segment) =>
            element("Segment", { ID: segment.id, Name: segment.name }, children(segment.members))))])));
    const plan = (panel.memberGroups || []).filter((group) => group.type === "PlanBracing").map((group) =>
        element("PlanBracing", { ID: group.id, Name: group.label }, children(group.members)));
    return element("Panel", mapped(panel.sourceAttributes && panel.sourceAttributes.panel, { ID: panel.id }), [
        legs, faces, element("PlanBracingDetails", {}, plan), element("HipBracingDetails"),
    ]);
}

const sectionDimensionKeys = ["Radius", "WallThickness", "Width", "Depth", "Thickness", "FilletRadius", "EdgeRadius", "OuterDiameter", "InnerDiameter", "Diameter", "Tnom"];

export function serialize(data: CommonData): string {
    const members = new Map(data.members.map((member): [string, Member] => [member.id, member]));
    const sections = data.sections.map((section) => {
        const original = { ...section.sourceAttributes };
        for (const key of sectionDimensionKeys) if (!Object.prototype.hasOwnProperty.call(section.dimensions, key)) delete original[key];
        const values: Record<string, AttributeValue> = { ID: section.id, Name: section.shape, ...section.dimensions };
        if (section.name !== undefined) values.SectionName = section.name;
        return [
            element("Section", mapped(original, values)),
            ...(section.contour || []).map((p) => element("PolyLine", mapped(undefined, { RefID: section.id, PolygonID: p.polygonId, X: p.x, Y: p.y, Z: p.z }))),
        ];
    }).reduce<Element[]>((all, entries) => all.concat(entries), []);
    const materials = data.materials.reduce<Element[]>((all, m) => all.concat([
        element("Material", { ID: m.id, Name: m.name }),
        ...m.properties.map((p) => element("MaterialProperty", { RefID: m.id, Name: p.name, Description: p.description, Value: p.value, Unit: p.unit })),
    ]), []);
    const omittedNodes = supportOnlyNodeIds(data);
    const nodes = data.nodes.filter((node) => !omittedNodes.has(node.id)).map((node) => element("Node", mapped(node.sourceAttributes, { ID: node.id, X: node.x, Y: node.y, Z: node.z })));
    const projectElement = project(data);
    const towerElement = tower(data);
    const panelProperties = element("PanelProperties", {}, data.panels.map(panelProperty));
    const panels = data.panels.map((panel) => panelElement(panel, members));
    const nodeTable = element("Nodes", {}, nodes);
    const sectionTable = element("Sections", {}, sections);
    const materialTable = materials.length ? [element("Materials", {}, materials)] : [];
    const elements = [sectionTable, ...materialTable, nodeTable, panelProperties, ...panels, projectElement, towerElement];
    const document: Element = {
        declaration: { attributes: { version: "1.0", encoding: "UTF-8" } },
        elements: [element("Staad", {}, elements)],
    };
    return js2xml(document, {
        compact: false, spaces: 2,
        attributeValueFn: (_value, key, _name, current) => String((current as Element).attributes![key])
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
            .replace(/\r/g, "&#13;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;"),
    });
}
