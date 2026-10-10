using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvReadingArchiveFileIdentityTests
{
    [Fact]
    public void LinuxSymlinkIdentityFollowsReplacedTargetWithMatchingSizeAndMtime()
    {
        if (!OperatingSystem.IsLinux()) return;
        var directory = Directory.CreateTempSubdirectory("ptv-fileidentity-regression-");
        try
        {
            var target = Path.Combine(directory.FullName, "target.cbz");
            var replacement = Path.Combine(directory.FullName, "replacement.cbz");
            var link = Path.Combine(directory.FullName, "archive.cbz");
            File.WriteAllText(target, "synthetic archive");
            File.CreateSymbolicLink(link, target);
            var before = PtvReadingArchiveFileIdentity.Read(link);
            Assert.NotNull(before);
            var modified = File.GetLastWriteTimeUtc(target);
            var length = new FileInfo(target).Length;
            File.WriteAllText(replacement, "synthetic archive");
            File.SetLastWriteTimeUtc(replacement, modified);
            File.Move(replacement, target, overwrite: true);
            Assert.Equal(length, new FileInfo(target).Length);
            Assert.Equal(modified, File.GetLastWriteTimeUtc(target));
            var after = PtvReadingArchiveFileIdentity.Read(link);
            Assert.NotNull(after);
            Assert.NotEqual(before, after);
            Assert.Equal(PtvReadingArchiveFileIdentity.Read(target), after);
        }
        finally { Directory.Delete(directory.FullName, recursive: true); }
    }

    [Fact]
    public void LinuxDanglingSymlinkHasNoAvailableTargetIdentity()
    {
        if (!OperatingSystem.IsLinux()) return;
        var directory = Directory.CreateTempSubdirectory("ptv-fileidentity-dangling-");
        try
        {
            var link = Path.Combine(directory.FullName, "archive.cbz");
            File.CreateSymbolicLink(link, Path.Combine(directory.FullName, "missing.cbz"));
            Assert.Null(PtvReadingArchiveFileIdentity.Read(link));
        }
        finally { Directory.Delete(directory.FullName, recursive: true); }
    }
}
