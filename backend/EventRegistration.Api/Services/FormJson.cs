using System.Text.Json;
using EventRegistration.Api.Models;

namespace EventRegistration.Api.Services;

/// <summary>Serialize/deserialize the custom form schema and response blobs stored as JSON.</summary>
public static class FormJson
{
    private static readonly JsonSerializerOptions Opts = new() { PropertyNameCaseInsensitive = true };

    public static List<FormFieldDef> ReadSchema(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<List<FormFieldDef>>(json, Opts) ?? new(); }
        catch { return new(); }
    }

    public static string WriteSchema(List<FormFieldDef>? fields) =>
        JsonSerializer.Serialize(fields ?? new(), Opts);

    public static Dictionary<string, string> ReadResponses(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<Dictionary<string, string>>(json, Opts) ?? new(); }
        catch { return new(); }
    }

    public static string WriteResponses(Dictionary<string, string>? responses) =>
        JsonSerializer.Serialize(responses ?? new(), Opts);

    public static List<ScheduleItem> ReadSchedule(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<List<ScheduleItem>>(json, Opts) ?? new(); }
        catch { return new(); }
    }

    // Persist only rows that have an activity; trims each field.
    public static string? WriteSchedule(List<ScheduleItem>? items)
    {
        var rows = (items ?? new())
            .Where(i => !string.IsNullOrWhiteSpace(i.Activity))
            .Select(i => new ScheduleItem(i.Day?.Trim(), i.Time?.Trim(), i.Activity.Trim()))
            .ToList();
        return rows.Count == 0 ? null : JsonSerializer.Serialize(rows, Opts);
    }

    /// <summary>Returns the first required field left blank, or null when all are satisfied.
    /// Conditionally-hidden fields (their ShowWhen rule isn't met) are skipped.</summary>
    public static string? FirstMissingRequired(List<FormFieldDef> fields, Dictionary<string, string>? responses)
    {
        responses ??= new();
        foreach (var f in fields)
        {
            if (!f.Required) continue;
            if (!IsVisible(f, responses)) continue; // hidden by its condition → not required
            if (!responses.TryGetValue(f.Key, out var v) || string.IsNullOrWhiteSpace(v))
                return f.Label;
        }
        return null;
    }

    /// <summary>Whether a field is currently shown given the answers so far. A field with no
    /// ShowWhen rule is always visible; otherwise it shows only when the controlling field's
    /// answer equals ShowWhenValue.</summary>
    // (frontend mirror lives in DynamicFieldsComponent.isVisible)
    public static bool IsVisible(FormFieldDef f, IReadOnlyDictionary<string, string> responses)
    {
        if (string.IsNullOrWhiteSpace(f.ShowWhenField)) return true;
        return responses.TryGetValue(f.ShowWhenField!, out var v) &&
               string.Equals(v?.Trim(), f.ShowWhenValue?.Trim(), StringComparison.Ordinal);
    }
}
