# Synthetic ComicInfo archive fixtures

All archive bytes are generated locally by `PtvComicInfoArchiveReaderTests` in a unique temporary directory and deleted by test teardown. No media, production archive, downloaded fixture, artwork, or third-party copyrighted payload is included.

Payload authored for this task (UTF-8):

`<ComicInfo><Series>Synthetic</Series><Number>9</Number></ComicInfo>`

- CBZ: .NET ZipArchive creates tiny stored/deflated archives. Page entries contain arbitrary test bytes, never images. Variants change names, external attributes, sizes, central-directory fields, and payload bytes.
- RAR4: the test's Rar generator writes the public seven-byte RAR4 signature, main header, stored file header, CRC-32, original XML, and end header. Combined archives reuse generated file blocks. Main/file flags model solid, multipart, encrypted, split, and Unix symlink cases. These are synthetic structural fixtures, not copies of third-party archives.
- RAR5: the test writes the public signature and variable-integer main/file/end headers with CRC-32 and a stored copy of the same original XML.
- Large-file boundary tests create logical file lengths at 1 GiB and 1 GiB + 1; they do not contain media or construct a GiB in-memory payload. Entry-limit tests generate repeated tiny page entries around 4,096.
- CRC corruption tests flip one selected stored payload byte without updating the archive checksum.

The store-mode fixtures prove selection and format handling through SharpCompress 0.50.4. They do not constitute exhaustive coverage of every RAR compression algorithm. Compressed CBZ expansion and output bounds are separately exercised. The helper intentionally does not interpret XML; XML parser rejection and character limits belong to the Plugin parsing task.

Reference format descriptions: https://www.rarlab.com/technote.htm and SharpCompress 0.50.4 source at https://github.com/adamhathcock/sharpcompress/tree/0.50.4/src/SharpCompress/Common/Rar . No reference fixture bytes are copied.

## ZIP header consistency fixtures

Review-fix fixtures alter only one local field (name, compressed size, uncompressed size, general-purpose flags, encryption bit, or method), or mutate the payload and local CRC while retaining the original central CRC. They verify rejection before decoder construction. A synthetic Deflate ZIP writer also covers standard data descriptors and descriptor CRC corruption.

Tiny synthetic ZIP64 and Deflate64 fixtures are decoded by the native .NET ZIP reader and the isolated helper for parity. The gate now supports single-disk classic ZIP and ZIP64 for Stored, Deflate, and Deflate64; ZIP64 per-entry extra fields can appear with ordinary EOCD, or with the ZIP64 EOCD/locator pair. Signed/unsigned descriptors use their declared 32-bit or 64-bit sizes. Multi-disk, malformed, unsupported flags/methods, and extensible ZIP64 EOCD layouts remain typed unverified. No decoder reads ZIP extra fields or mutable headers.

## ZIP64 fixtures (review fix round 2)

`PtvComicInfoZip64Tests.cs` extends the same test class. Its fixture writer adds original ZIP64 size/offset records, EOCD/locator pairs, and 64-bit descriptors to the task-authored bytes. The matrix covers Stored, Deflate, and Deflate64 with both EOCD layouts and signed/unsigned descriptors; empty/no-ComicInfo archives, conditional central fields, malformed and inconsistent records, CRC/ratio/size limits, and 4,096-entry / 1 GiB boundaries are also covered. The 1 GiB fixture is made with a logical file gap before the tiny central-directory trailer, without constructing a GiB array.

The descriptor-marker collision payload (`AC 0A 7A D5`) was constructed locally to have CRC-32 `08074B50`; a fixture assertion verifies that property before testing optional-signature interpretation. It is arbitrary test data, not XML or media. Native parity is asserted for normal supported variants. The redundant central disk-number sentinel expanded to disk 0 is separately tested against the format contract; .NET itself rejects that redundant variant as split/spanned, so no native parity claim is made for it.

ZIP64 field reference: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (sections 4.3.9, 4.3.14–16, and 4.5.3). No archive fixture bytes are copied from that source.
