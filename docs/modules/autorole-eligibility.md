# AutoRole Eligibility Foundation

This foundation evaluates whether a configured Free AutoRole may be assigned.
It returns a transport-neutral structured result and performs no Discord calls,
configuration writes, automatic assignment, route registration, logging, or
member-join integration. `AutoRoleEligibilityMapper` transforms data only;
`AutoRoleEligibilityService` owns business validation. Assignment is a later
separate block.
