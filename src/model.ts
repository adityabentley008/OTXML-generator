export type SourceAttributes = Record<string, string>;

export interface Location {
    latitudeDegrees: number;
    longitudeDegrees: number;
    altitudeMetres: number;
    altitudeBasis?: string;
}

export interface ProjectData {
    projectId: string;
    siteName?: string;
    location: Location;
    sourceAttributes?: SourceAttributes;
}

export interface TowerInformation {
    id: string;
    name: string;
    type: string;
    height: number;
    numberOfLegs: number;
    declaredPanelCount: number;
    bearingAngleDegrees: number;
    topFaceWidth: number;
    topFaceDepth: number;
    bottomFaceWidth: number;
    bottomFaceDepth: number;
    concreteHeight?: number;
    tiltX?: number;
    tiltY?: number;
    convention?: string;
    unitSystem?: string;
    towerShape?: string;
    otxmlAngle?: number;
    orientation?: string;
    partialExport?: boolean;
    sourceAttributes?: SourceAttributes;
}

export interface Node {
    id: string;
    x: number;
    y: number;
    z: number;
    sourceAttributes?: SourceAttributes;
}

export interface Member {
    id: string;
    startNodeId: string;
    endNodeId: string;
    sectionId: string;
    betaAngleDegrees: number;
    label: string;
    tag?: string;
    materialId?: string;
    materialAssignmentSource?: "exported" | "assumed";
    startRelease?: string;
    endRelease?: string;
    sourceElementId?: string;
    sourceAttributes?: SourceAttributes;
}

export interface Section {
    id: string;
    shape: string;
    name?: string;
    dimensions: Record<string, number>;
    contour?: Array<{ polygonId: string; x: number; y: number; z: number }>;
    sourceAttributes?: SourceAttributes;
}

export interface Leg { name: string; members: string[]; }
export interface Segment { id: string; name: string; members: string[]; }
export interface Face { id: string; name: string; segments: Segment[]; }
export interface Panel {
    id: string;
    label: string;
    height: number;
    topWidth: number;
    bottomWidth: number;
    topElevation: number;
    bottomElevation: number;
    faceBracing: string;
    planBracing: string;
    hipBracing: string;
    numberOfSegments: number;
    weight: number;
    legs: Leg[];
    faces: Face[];
    sourceAttributes?: { panel?: SourceAttributes; panelProperty?: SourceAttributes };
}

export interface Unit { unit: string; basis?: string; }
export interface Material {
    id: string;
    name: string;
    propertiesSource: "assumed" | "exported";
    properties: Array<{ name: string; description: string; value: string; unit: string }>;
}
export interface CommonData {
    schemaVersion: "1.0-draft";
    source: { format: string; fileName: string };
    units: {
        nodeCoordinates: Unit;
        panelDimensions: Unit;
        towerDimensions: Unit;
        sectionDimensions: Unit;
        panelWeight: Unit;
    };
    coordinateSystem: { upAxis: "Y"; basis?: string };
    projectData: ProjectData;
    towerInformation: TowerInformation;
    panels: Panel[];
    nodes: Node[];
    members: Member[];
    sections: Section[];
    materials: Material[];
    notes?: string[];
}
