/**
 * Ensure iconv-lite GB18030 tables are pulled into bundled/EXE builds.
 */
import iconv from "iconv-lite";

// Touch codec so bundlers and pkg retain the encoding tables.
void iconv.encodingExists("gb18030");
void iconv.encode("测", "gb18030");
