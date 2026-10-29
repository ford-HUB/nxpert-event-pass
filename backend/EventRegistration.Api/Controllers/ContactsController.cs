using EventRegistration.Api.Data;
using EventRegistration.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Controllers;

// Every system user with an email address, for the invitation composer's To / CC picker.
[ApiController]
[Route("api/contacts")]
[Authorize(Roles = Roles.Admin + "," + Roles.SuperAdmin)]
public class ContactsController : ControllerBase
{
    private readonly AppDbContext _db;
    public ContactsController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ContactDto>>> List()
    {
        var contacts = await _db.Users
            .Where(u => u.Email != "")
            .OrderBy(u => u.FullName)
            .Select(u => new ContactDto(u.Id, u.FullName, u.Email, u.Organization))
            .ToListAsync();
        return Ok(contacts);
    }
}
