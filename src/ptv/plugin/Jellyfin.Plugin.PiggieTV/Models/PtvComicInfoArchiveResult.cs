using System.Text.Json;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>Internal archive bytes, never a Web response or a filesystem-path carrier.</summary>
public sealed class PtvComicInfoBytesResult
{
    /// <summary>Creates a result whose byte allocation cannot exceed the archive contract.</summary>
    public PtvComicInfoBytesResult(string state, string reasonCode, byte[] bytes)
    {
        if (bytes is null || bytes.Length > 524288) throw new JsonException("HELPER_PROTOCOL_INVALID");
        State = state;
        ReasonCode = reasonCode;
        Bytes = bytes;
    }

    /// <summary>inspected, absent, or unverified; host validates the wire state.</summary>
    public string State { get; }
    /// <summary>Bounded stable code, never exception text or a server path.</summary>
    public string ReasonCode { get; }
    /// <summary>At most 512 KiB of internal ComicInfo content.</summary>
    public byte[] Bytes { get; }
}
