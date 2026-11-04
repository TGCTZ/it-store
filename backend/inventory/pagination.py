"""Shared page-size limits for resource lists and API clients."""

from rest_framework.pagination import PageNumberPagination


class ResourcePagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100
