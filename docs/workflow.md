# Workflow and data rules

## Accounts and people

IT Store has one login account, the Superadmin. Create it with Django’s `createsuperuser` command; there is no in-app user-management screen or account-management API. The Superadmin can change their own password. People receiving equipment are reusable contact records, not login accounts. First and last names are stored in uppercase. Recipient type is Employee, Student, or Guest, with Employee as the default.

## Assets and accessories

Each physical item has a unique name and an automatically generated internal ID. The interface does not show the ID. Asset names are stored in uppercase. A Superadmin assigns accessories to an asset from the shared accessory option list. Options can be added, renamed, and deleted when no asset uses them.

## Checkouts

Each checkout records one person and exactly one asset. A person can have multiple checkout records, including concurrent records for different assets. Only an available asset can be checked out, and the database prevents a second active checkout for the same asset.

The checkout stores a snapshot of the person’s name and phone number, the asset name, and the selected accessories at issue time. Editing an active checkout can change the asset or its issued accessories. The activity history records material events and their Superadmin actor.

## Return and status rules

Asset status describes the current physical item:

| Status | Meaning |
| --- | --- |
| Available | Can be checked out. |
| Checked out | Has an active checkout. |
| Missing accessories | Needs its accessory list reviewed before reuse. |
| Needs repair | Returned damaged and unavailable until repaired and resolved. |
| Lost | Reported lost and unavailable until its status is resolved. |
| Retired | Removed from circulation; its history remains. |

Checkout item status describes the outcome of that specific handover:

| Status | Meaning |
| --- | --- |
| Checked out | Has not been resolved as returned or lost. |
| Returned | Asset and all issued accessories were returned. |
| Partially returned | Asset came back, but one or more issued accessories are missing. |
| Returned damaged | Asset was returned damaged. |
| Lost | Asset was reported lost. |

When an item is returned with missing accessories, the checkout item is Partially returned and the asset becomes Available for another checkout. Accessories still marked missing cannot be issued with that asset again until the Superadmin records them received. A damaged asset remains Needs repair, even if its missing accessories are later recovered. A lost asset remains Lost until its status is resolved.

The checkout detail view shows automatic activity events. Return notes belong to the checkout item; the app has no recipient notes, checkout notes, or due dates.
