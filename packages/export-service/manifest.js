// @ts-check
/**
 * SCORM 2004 4th Edition imsmanifest.xml generator.
 *
 * Emits a single-SCO content package conforming to the SCORM 2004 4th Edition
 * Content Aggregation Model: IMS Content Packaging 1.1.4 plus the ADL SCORM
 * namespaces and IMS Simple Sequencing (imsss).
 */

/**
 * @param {import('@sowb/shared').Workbook} workbook
 * @param {string[]} resourceFiles Relative file paths included in the package.
 * @returns {string} imsmanifest.xml content
 */
export function buildManifest(workbook, resourceFiles) {
  const courseId = safeId(workbook.courseId || workbook.id || 'observation-workbook');
  const manifestId = `MANIFEST-${courseId}`;
  const orgId = `ORG-${courseId}`;
  const itemId = `ITEM-${courseId}`;
  const resId = `RES-${courseId}`;
  const title = xml(workbook.title || 'Observation Workbook');
  const version = xml(workbook.version || '1.0');

  const fileEntries = resourceFiles.slice().sort()
    .map((f) => `        <file href="${xmlAttr(f)}" />`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${xmlAttr(manifestId)}" version="${version}"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
    http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
    http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
    http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd
    http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="${xmlAttr(orgId)}">
    <organization identifier="${xmlAttr(orgId)}" adlseq:objectivesGlobalToSystem="false">
      <title>${title}</title>
      <item identifier="${xmlAttr(itemId)}" identifierref="${xmlAttr(resId)}" isvisible="true">
        <title>${title}</title>
        <adlcp:completionThreshold completedByMeasure="true" minProgressMeasure="1.0" />
        <imsss:sequencing>
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="PRIMARYOBJ" satisfiedByMeasure="false">
              <imsss:mapInfo targetObjectiveID="${xmlAttr('OBJ-' + courseId)}"
                readSatisfiedStatus="true" writeSatisfiedStatus="true" />
            </imsss:primaryObjective>
          </imsss:objectives>
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true" />
        </imsss:sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="${xmlAttr(resId)}" type="webcontent"
      adlcp:scormType="sco" href="index.html">
${fileEntries}
    </resource>
  </resources>
</manifest>
`;
}

function safeId(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'workbook';
}
function xml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function xmlAttr(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
