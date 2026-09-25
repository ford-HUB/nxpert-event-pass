using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using EventRegistration.Api.Models;
using Microsoft.IdentityModel.Tokens;

namespace EventRegistration.Api.Services;

public class JwtSettings
{
    public string Key { get; set; } = "";
    public string Issuer { get; set; } = "";
    public string Audience { get; set; } = "";
    public int ExpiryHours { get; set; } = 8;
}

public class JwtService
{
    private readonly JwtSettings _s;
    public JwtService(JwtSettings s) => _s = s;

    public string CreateToken(User user)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.FullName),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Role, user.Role),
        };
        if (user.CanConfirmRegistrations)
            claims.Add(new Claim(Permissions.ConfirmRegistrations, "true"));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_s.Key));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: _s.Issuer,
            audience: _s.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddHours(_s.ExpiryHours),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
