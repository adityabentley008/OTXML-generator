import { CommonData } from "./model";

type Obj = Record<string, unknown>;

function object(value: unknown, path: string, keys: string[]): Obj {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object.`);
    const result = value as Obj;
    for (const key of Object.keys(result)) if (!keys.includes(key)) throw new Error(`Unsupported field ${path}.${key}.`);
    return result;
}

function text(value: unknown, path: string, allowEmpty = false): void {
    if (typeof value !== "string" || (!allowEmpty && !value.length)) throw new Error(`${path} must be ${allowEmpty ? "a" : "a nonempty"} string.`);
}

function numeric(value: unknown, path: string): void {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
}

function list(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
    return value;
}

function attributes(value: unknown, path: string): void {
    if (value === undefined) return;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object of strings.`);
    for (const [key, val] of Object.entries(value)) text(val, `${path}.${key}`, true);
}

function fields(o: Obj, path: string, strings: string[], numbers: string[]): void {
    for (const key of strings) text(o[key], `${path}.${key}`);
    for (const key of numbers) numeric(o[key], `${path}.${key}`);
}

function unique(values: string[], label: string): void {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`);
}

export function validateCommonData(value: unknown): asserts value is CommonData {
    const root = object(value, "data", ["schemaVersion", "source", "units", "coordinateSystem", "projectData", "towerInformation", "panels", "nodes", "members", "sections", "materials", "notes"]);
    if (root.schemaVersion !== "1.0-draft") throw new Error("Unsupported schemaVersion; expected 1.0-draft.");
    const source = object(root.source, "source", ["format", "fileName"]);
    fields(source, "source", ["format", "fileName"], []);
    const units = object(root.units, "units", ["nodeCoordinates", "panelDimensions", "towerDimensions", "sectionDimensions", "panelWeight"]);
    for (const [key, expected] of Object.entries({ nodeCoordinates: "m", panelDimensions: "ft", towerDimensions: "ft", sectionDimensions: "in", panelWeight: "unknown" })) {
        const unit = object(units[key], `units.${key}`, ["unit", "basis"]);
        if (unit.unit !== expected) throw new Error(`units.${key}.unit must be ${expected}; unit conversion is not supported.`);
        if (unit.basis !== undefined) text(unit.basis, `units.${key}.basis`, true);
    }
    const coordinates = object(root.coordinateSystem, "coordinateSystem", ["upAxis", "basis"]);
    if (coordinates.upAxis !== "Y") throw new Error("coordinateSystem.upAxis must be Y.");
    if (coordinates.basis !== undefined) text(coordinates.basis, "coordinateSystem.basis", true);
    const project = object(root.projectData, "projectData", ["projectId", "siteName", "location", "sourceAttributes"]);
    fields(project, "projectData", ["projectId"], []);
    if (project.siteName !== undefined) text(project.siteName, "projectData.siteName");
    attributes(project.sourceAttributes, "projectData.sourceAttributes");
    const location = object(project.location, "projectData.location", ["latitudeDegrees", "longitudeDegrees", "altitudeMetres", "altitudeBasis"]);
    fields(location, "projectData.location", [], ["latitudeDegrees", "longitudeDegrees", "altitudeMetres"]);
    if (location.altitudeBasis !== undefined) text(location.altitudeBasis, "projectData.location.altitudeBasis", true);
    const tower = object(root.towerInformation, "towerInformation", ["id", "name", "type", "height", "numberOfLegs", "declaredPanelCount", "bearingAngleDegrees", "topFaceWidth", "topFaceDepth", "bottomFaceWidth", "bottomFaceDepth", "concreteHeight", "tiltX", "tiltY", "convention", "unitSystem", "towerShape", "otxmlAngle", "orientation", "partialExport", "sourceAttributes"]);
    fields(tower, "towerInformation", ["id", "name", "type"], ["height", "numberOfLegs", "declaredPanelCount", "bearingAngleDegrees", "topFaceWidth", "topFaceDepth", "bottomFaceWidth", "bottomFaceDepth"]);
    for (const key of ["concreteHeight", "tiltX", "tiltY", "otxmlAngle"]) if (tower[key] !== undefined) numeric(tower[key], `towerInformation.${key}`);
    for (const key of ["convention", "unitSystem", "towerShape", "orientation"]) if (tower[key] !== undefined) text(tower[key], `towerInformation.${key}`);
    if (tower.partialExport !== undefined && typeof tower.partialExport !== "boolean") throw new Error("towerInformation.partialExport must be a boolean.");
    for (const key of ["numberOfLegs", "declaredPanelCount"]) if (!Number.isInteger(tower[key]) || (tower[key] as number) < 1) throw new Error(`towerInformation.${key} must be a positive integer.`);
    attributes(tower.sourceAttributes, "towerInformation.sourceAttributes");

    const ids: Record<string, string[]> = { panels: [], nodes: [], members: [], sections: [] };
    const usages: string[] = [];
    for (const [index, raw] of list(root.panels, "panels").entries()) {
        const path = `panels[${index}]`;
        const p = object(raw, path, ["id", "label", "height", "topWidth", "bottomWidth", "topElevation", "bottomElevation", "faceBracing", "planBracing", "hipBracing", "numberOfSegments", "weight", "legs", "faces", "sourceAttributes"]);
        fields(p, path, ["id", "label", "faceBracing", "planBracing", "hipBracing"], ["height", "topWidth", "bottomWidth", "topElevation", "bottomElevation", "numberOfSegments", "weight"]);
        if (!Number.isInteger(p.numberOfSegments) || (p.numberOfSegments as number) < 0) throw new Error(`${path}.numberOfSegments must be a nonnegative integer.`);
        if (p.planBracing !== "None" || p.hipBracing !== "None") throw new Error(`${path}: plan and hip bracing are not supported.`);
        ids.panels.push(p.id as string);
        if (p.sourceAttributes !== undefined) {
            const a = object(p.sourceAttributes, `${path}.sourceAttributes`, ["panel", "panelProperty"]);
            attributes(a.panel, `${path}.sourceAttributes.panel`);
            attributes(a.panelProperty, `${path}.sourceAttributes.panelProperty`);
        }
        for (const [i, rawLeg] of list(p.legs, `${path}.legs`).entries()) {
            const legPath = `${path}.legs[${i}]`;
            const leg = object(rawLeg, legPath, ["name", "members"]);
            text(leg.name, `${legPath}.name`);
            for (const id of list(leg.members, `${legPath}.members`)) { text(id, `${legPath}.members`); usages.push(id as string); }
        }
        for (const [i, rawFace] of list(p.faces, `${path}.faces`).entries()) {
            const facePath = `${path}.faces[${i}]`;
            const face = object(rawFace, facePath, ["id", "name", "segments"]);
            fields(face, facePath, ["id", "name"], []);
            for (const [j, rawSegment] of list(face.segments, `${facePath}.segments`).entries()) {
                const segmentPath = `${facePath}.segments[${j}]`;
                const segment = object(rawSegment, segmentPath, ["id", "name", "members"]);
                fields(segment, segmentPath, ["id", "name"], []);
                for (const id of list(segment.members, `${segmentPath}.members`)) { text(id, `${segmentPath}.members`); usages.push(id as string); }
            }
        }
    }
    for (const [index, raw] of list(root.nodes, "nodes").entries()) {
        const path = `nodes[${index}]`;
        const node = object(raw, path, ["id", "x", "y", "z", "sourceAttributes"]);
        fields(node, path, ["id"], ["x", "y", "z"]); attributes(node.sourceAttributes, `${path}.sourceAttributes`);
        ids.nodes.push(node.id as string);
    }
    for (const [index, raw] of list(root.sections, "sections").entries()) {
        const path = `sections[${index}]`;
        const section = object(raw, path, ["id", "shape", "name", "dimensions", "contour", "sourceAttributes"]);
        fields(section, path, ["id", "shape"], []); attributes(section.sourceAttributes, `${path}.sourceAttributes`);
        if (section.name !== undefined) text(section.name, `${path}.name`);
        if (section.contour !== undefined) for (const [i, rawPoint] of list(section.contour, `${path}.contour`).entries()) {
            const pointPath = `${path}.contour[${i}]`;
            const point = object(rawPoint, pointPath, ["polygonId", "x", "y", "z"]);
            fields(point, pointPath, ["polygonId"], ["x", "y", "z"]);
        }
        if (typeof section.dimensions !== "object" || section.dimensions === null || Array.isArray(section.dimensions)) throw new Error(`${path}.dimensions must be an object.`);
        const supportedDimensions = ["Radius", "WallThickness", "Width", "Depth", "Thickness", "FilletRadius", "EdgeRadius", "OuterDiameter", "InnerDiameter", "Diameter", "Tnom"];
        for (const [key, dimension] of Object.entries(section.dimensions)) {
            if (!supportedDimensions.includes(key)) throw new Error(`Unsupported field ${path}.dimensions.${key}.`);
            numeric(dimension, `${path}.dimensions.${key}`);
        }
        ids.sections.push(section.id as string);
    }
    unique(ids.nodes, "nodes ID");
    unique(ids.sections, "sections ID");
    const nodeIds = new Set(ids.nodes);
    const sectionIds = new Set(ids.sections);
    const materialIds = new Set<string>();
    for (const [index, raw] of list(root.materials, "materials").entries()) {
        const path = `materials[${index}]`;
        const material = object(raw, path, ["id", "name", "propertiesSource", "properties"]);
        fields(material, path, ["id", "name", "propertiesSource"], []);
        if (material.propertiesSource !== "assumed" && material.propertiesSource !== "exported") throw new Error(`${path}.propertiesSource must be assumed or exported.`);
        if (materialIds.has(material.id as string)) throw new Error("Duplicate materials ID.");
        materialIds.add(material.id as string);
        for (const [i, rawProperty] of list(material.properties, `${path}.properties`).entries()) {
            const propPath = `${path}.properties[${i}]`;
            const prop = object(rawProperty, propPath, ["name", "description", "value", "unit"]);
            text(prop.name, `${propPath}.name`);
            for (const key of ["description", "value", "unit"]) text(prop[key], `${propPath}.${key}`, true);
        }
    }
    const members = list(root.members, "members");
    for (const [index, raw] of members.entries()) {
        const path = `members[${index}]`;
        const member = object(raw, path, ["id", "startNodeId", "endNodeId", "sectionId", "betaAngleDegrees", "label", "tag", "materialId", "materialAssignmentSource", "startRelease", "endRelease", "sourceElementId", "sourceAttributes"]);
        fields(member, path, ["id", "startNodeId", "endNodeId", "sectionId", "label"], ["betaAngleDegrees"]);
        if (member.tag !== undefined) text(member.tag, `${path}.tag`);
        for (const key of ["materialId", "startRelease", "endRelease", "sourceElementId"]) if (member[key] !== undefined) text(member[key], `${path}.${key}`);
        if (member.materialAssignmentSource !== undefined && member.materialAssignmentSource !== "assumed" && member.materialAssignmentSource !== "exported") throw new Error(`${path}.materialAssignmentSource must be assumed or exported.`);
        if (member.materialId !== undefined && !materialIds.has(member.materialId as string)) throw new Error(`${path} references a missing material.`);
        if (member.materialAssignmentSource !== undefined && member.materialId === undefined) throw new Error(`${path}.materialAssignmentSource requires materialId.`);
        attributes(member.sourceAttributes, `${path}.sourceAttributes`);
        if (member.sourceAttributes !== undefined) {
            const rawAttributes = member.sourceAttributes as Record<string, string>;
            for (const [field, attribute] of [["materialId", "MaterialID"], ["startRelease", "StartRelease"], ["endRelease", "EndRelease"]]) {
                if (rawAttributes[attribute] !== undefined && member[field] === undefined) {
                    throw new Error(`${path}.${field} is required when sourceAttributes.${attribute} is present.`);
                }
            }
        }
        if (!nodeIds.has(member.startNodeId as string) || !nodeIds.has(member.endNodeId as string)) throw new Error(`${path} references a missing node.`);
        if (!sectionIds.has(member.sectionId as string)) throw new Error(`${path} references a missing section.`);
        ids.members.push(member.id as string);
    }
    for (const [key, values] of Object.entries(ids)) unique(values, `${key} ID`);
    unique(usages, "member reference");
    const memberIds = new Set(ids.members);
    const referenced = new Set(usages);
    for (const id of usages) if (!memberIds.has(id)) throw new Error(`Missing referenced member ${id}.`);
    for (const id of ids.members) if (!referenced.has(id)) throw new Error(`Member ${id} is not referenced by a panel.`);
    if (!ids.panels.length || ids.panels.length > (tower.declaredPanelCount as number)) throw new Error("Panel count is empty or exceeds declaredPanelCount.");
    if (tower.partialExport === true && ids.panels.length >= (tower.declaredPanelCount as number)) throw new Error("partialExport requires fewer panels than declaredPanelCount.");
    if (root.notes !== undefined) for (const note of list(root.notes, "notes")) text(note, "notes entry", true);
}
