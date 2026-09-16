using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Shared environment-only OpenAI credential boundary helpers.</summary>
internal static class PtvOpenAiSecretSafety
{
    internal const string ApiKeyEnvironmentVariable = "OPENAI_API_KEY";

    internal static string? CleanCredential(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var cleaned = value.Trim();
        return cleaned.Length == 0 ? null : cleaned;
    }

    internal static bool MatchesCredential(string? candidate, string? credential)
    {
        var normalizedCandidate = candidate?.Trim();
        var normalizedCredential = CleanCredential(credential);
        if (string.IsNullOrEmpty(normalizedCandidate) || normalizedCredential is null) return false;

        var candidateHash = SHA256.HashData(Encoding.UTF8.GetBytes(normalizedCandidate));
        var credentialHash = SHA256.HashData(Encoding.UTF8.GetBytes(normalizedCredential));
        return CryptographicOperations.FixedTimeEquals(candidateHash, credentialHash);
    }
}
