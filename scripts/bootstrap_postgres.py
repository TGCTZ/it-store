"""Create the local IT Store database using the PostgreSQL admin account."""

import os
import sys

import psycopg
from psycopg import sql


def main():
    admin_user = "postgres"
    admin_password = os.environ["ITSTORE_PG_ADMIN_PASSWORD"]
    database = "itstore"

    with psycopg.connect(
        host="localhost",
        port=5432,
        dbname="postgres",
        user=admin_user,
        password=admin_password,
        connect_timeout=5,
        autocommit=True,
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (database,))
            if cursor.fetchone():
                raise RuntimeError(
                    f"The PostgreSQL database '{database}' already exists. "
                    "Set up backend/.env manually to avoid using existing data unexpectedly."
                )

            cursor.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(database), sql.Identifier(admin_user)
                )
            )

    print("Created the PostgreSQL database.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"PostgreSQL bootstrap failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
