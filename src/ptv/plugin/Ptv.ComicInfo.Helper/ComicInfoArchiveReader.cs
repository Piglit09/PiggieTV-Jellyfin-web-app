using Jellyfin.Plugin.PiggieTV.Models;
using SharpCompress.Archives;
using SharpCompress.Archives.Rar;
using SharpCompress.Common;
using SharpCompress.Common.Rar;
using SharpCompress.Readers;
using SharpCompress.Readers.Rar;

namespace Ptv.ComicInfo.Helper;

/// <summary>Internal byte reader. Invoke only inside the OS-limited helper.</summary>
public static class ComicInfoArchiveReader
{
    private const long ArchiveLimit = 1073741824;
    private const int EntryLimit = 4096;
    private const int DocumentLimit = 524288;
    private const long CompressedLimit = 1048576;
    private static PtvComicInfoBytesResult Reject(string code) => new("unverified", code, []);

    public static PtvComicInfoBytesResult Read(string path)
    {
        try
        {
            var extension = Path.GetExtension(path);
            var rar = extension.Equals(".cbr", StringComparison.OrdinalIgnoreCase) || extension.Equals(".rar", StringComparison.OrdinalIgnoreCase);
            if (!rar && !extension.Equals(".cbz", StringComparison.OrdinalIgnoreCase) && !extension.Equals(".zip", StringComparison.OrdinalIgnoreCase))
                return Reject("COMICINFO_FORMAT_UNSUPPORTED");
            // The only filesystem open: the post-limit IPC path, read-only. Never use
            // SharpCompress's path overload (which can discover adjacent RAR volumes).
            using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (file.Length > ArchiveLimit) return Reject("COMICINFO_ARCHIVE_SIZE_LIMIT");
            var options = new ReaderOptions { LeaveStreamOpen = true, LookForHeader = false };
            if (rar)
            {
                // RarArchive groups split file parts before yielding an entry. Count
                // yielded file entries first so a hostile split chain cannot evade the cap.
                // SharpCompress can process service headers before yielding a file;
                // OS memory limits and the watchdog bound that hidden library work.
                using (var reader = RarReader.OpenReader(file, options))
                {
                    var count = 0;
                    while (reader.MoveToNextEntry())
                    {
                        if (++count > EntryLimit) return Reject("COMICINFO_ARCHIVE_ENTRY_LIMIT");
                        if (reader.Entry.IsSolid || reader.Entry.IsSplitAfter || reader.Entry.IsEncrypted)
                            return Reject("COMICINFO_RAR_UNSUPPORTED");
                        // Positive-size non-solid entries are skipped as raw compressed
                        // bytes by SharpCompress. Reject contradictory zero-size headers
                        // before the reader can fall back to decoding a page to skip it.
                        if (!reader.Entry.IsDirectory && reader.Entry.CompressedSize == 0 && reader.Entry.Size != 0)
                            return Reject("COMICINFO_UNAVAILABLE");
                    }
                    if (reader is RarReader { Volume: { } volume } && (volume.IsSolidArchive || volume.IsMultiVolume))
                        return Reject("COMICINFO_RAR_UNSUPPORTED");
                }
                file.Position = 0;
                using var archive = RarArchive.OpenArchive(file, options);
                return SelectRar(archive.Entries);
            }
            return ZipComicInfoArchiveReader.Read(file);
        }
        catch (MultiVolumeExtractionException) { return Reject("COMICINFO_RAR_UNSUPPORTED"); }

        catch { return Reject("COMICINFO_UNAVAILABLE"); } // Never serialize decoder exception text.
    }

    private static PtvComicInfoBytesResult SelectRar(IEnumerable<IArchiveEntry> entries)
    {
        IArchiveEntry? selected = null;
        var count = 0;
        foreach (var entry in entries)
        {
            if (++count > EntryLimit) return Reject("COMICINFO_ARCHIVE_ENTRY_LIMIT");
            if (entry.IsEncrypted || entry.IsSolid || entry is RarArchiveEntry { IsComplete: false })
                return Reject("COMICINFO_RAR_UNSUPPORTED");
            var name = entry.Key ?? "";
            var leaf = name.Replace('\\', '/').TrimEnd('/').Split('/').Last();
            if (!leaf.Equals("ComicInfo.xml", StringComparison.OrdinalIgnoreCase)) continue;
            var attributes = entry.Attrib ?? 0;
            var fileType = attributes & 0xf000;
            if (!name.Equals("ComicInfo.xml", StringComparison.OrdinalIgnoreCase)
                || entry.IsDirectory || entry.LinkTarget is not null || entry is RarEntry { IsRedir: true }
                || fileType is not (0 or 0x8000) || (attributes & 0x400) != 0)
                return Reject("COMICINFO_ENTRY_PATH_REJECTED");
            if (selected is not null) return Reject("COMICINFO_ENTRY_AMBIGUOUS");
            selected = entry;
        }
        if (selected is null) return new("absent", "COMICINFO_ABSENT", []);
        if (selected.IsEncrypted) return Reject("COMICINFO_ENCRYPTED");
        var size = selected.Size;
        var compressed = selected.CompressedSize;
        if (size < 0 || size > DocumentLimit || compressed < 0 || compressed > CompressedLimit
            || (size > 0 && (compressed == 0 || size > compressed * 100)))
            return Reject("COMICINFO_SIZE_LIMIT");
        using var input = selected.OpenEntryStream();
        // Never trust the advertised size to bound actual decompressor output.
        var bytes = new byte[(int)size];
        input.ReadExactly(bytes);
        if (input.ReadByte() != -1) return Reject("COMICINFO_SIZE_LIMIT");
        return new("inspected", "COMICINFO_READ", bytes);
    }

    internal static uint Crc32(byte[] bytes)
    {
        uint crc = uint.MaxValue;
        foreach (var value in bytes)
        {
            crc ^= value;
            for (var bit = 0; bit < 8; bit++)
                crc = (crc >> 1) ^ ((crc & 1) == 0 ? 0 : 0xedb88320u);
        }
        return ~crc;
    }
}
