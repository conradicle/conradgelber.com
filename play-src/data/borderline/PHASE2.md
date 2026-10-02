# Borderline phase 2: annexations to rebuild

CShapes 2.0 leaves out several annexations, and Borderline currently rejects
any crop that would show one (`CONTESTED_REJECT` in
`scripts/borderline/config.mjs`). The ones below can be drawn instead, using
only boundaries CShapes already has, through the record corrections in
`cs-dates.json` (`start`/`end` moves and `fill` records with another
record's shape). Overlaps need no clipping: the judge and the page draw the
older record on top, so a fill sits correctly against records that started
before it.

Not started. Each one needs: the corrections with sources, a judge test case
in `test/borderline/cases.json` (then `make-fixture.mjs`), removal of its
reject rule, a `build-bank.mjs --resume` (which rejudges everything first),
then `build-curated.mjs`, `build-maps.mjs` and the tests.

The rest (the 1939 German-Soviet line in Poland, the Second Vienna Award,
Yugoslavia's 1941 zones, the Bulgarian line in Greece, Manchukuo, Hatay,
Fiume, Tangier, the Saar, Trieste, Portuguese and French India) need
boundaries CShapes does not have, so they stay rejected.

## Austria, 13 March 1938 to 27 April 1945

End Austria's record (g305, from 1919-09-10) on 1938-03-12. Fill Germany
(g255) from 1938-03-13 to 1945-04-26 with Austria's shape, and fill Austria
(g305) again from 1945-04-27 with the same shape. Germany's records from
1938-09-30 on already include the Sudetenland; the page merges a unit's
records, so no seam shows at the old border.

## Albania, 7 April 1939 to 28 November 1944

Keep the shape and change the status: end Albania's record (g339) on
1939-04-06, fill Albania from 1939-04-07 to 1944-11-28 as a protectorate
owned by Italy (owner 325), which labels it "Albania (It.)", then fill
Albania as independent from 1944-11-29. The 1939 and 1944 label changes
become tells.

## Luxembourg, 1940 to 10 September 1944

End Luxembourg's record (g212) on the day before annexation and fill
Germany with Luxembourg's shape until 10 September 1944, then fill
Luxembourg again. Decide first which date to use: occupation on 10 May 1940
(not a border change by the phase 1 rules) or formal annexation on
30 August 1942.

## Ethiopia, 9 May 1936 to 4 May 1941

Same as Albania: end Ethiopia's record (g530) on 1936-05-08, fill it from
1936-05-09 to 1941-05-04 as a colony owned by Italy ("Ethiopia (It.)"),
then fill it as independent from 1941-05-05. Drawing Italian East Africa
as one unit would need a union of the Ethiopia, Eritrea and Italian
Somaliland shapes (mapshaper `-dissolve`); the labelled version needs no
new geometry.

## Czech lands and Slovakia, 14 March 1939 to 8 May 1945

End Czechoslovakia's record (g315, from 1938-11-02) on 1939-03-13. Fill the
Protectorate of Bohemia and Moravia with the Czech Republic's 1993 shape
(g316) as a protectorate owned by Germany, and the Slovak Republic with
Slovakia's 1993 shape (g317), both to 1945-05-08. Germany's Sudetenland
(from 1938-09-30) and Hungary's First Vienna Award gains (from 1938-11-02)
started earlier, so they draw on top and cut both shapes back to their
1939 extent. Restore Czechoslovakia from 1945-05-09.

## Carpathian Ruthenia, 15 March 1939 to 28 October 1944

Make Ruthenia's shape as Czechoslovakia's 1938 record less the 1993 Czech
Republic and Slovakia shapes (mapshaper `-erase`), add it as a record, and
fill Hungary (g310) with it for the period. After 1945 the area belongs to
the U.S.S.R., which CShapes already codes.

## Alsace-Lorraine, 22 June 1940 to February 1945

Make the Reichsland shape as France's record from 1919-06-28 less France's
record before it (the land that returned in 1919), with `-erase`. Fill
Germany with it for the period, ending when the Colmar Pocket closed on
9 February 1945 (Moselle and Strasbourg were freed in November 1944; split
the fill if that matters).

## Eupen-Malmedy, 18 May 1940 to 18 September 1944

Make the shape as Belgium's record from 1920 less its record before (the
land Belgium gained from Germany), with `-erase`. Fill Germany with it for
the period.

## Memel, 23 March 1939 to 27 January 1945

Make the shape as Lithuania's record that first includes the Klaipeda
region less the record before it, with `-erase`. Fill Germany with it for
the period. From 1945 the area follows Lithuania inside the U.S.S.R., as
CShapes codes it.
